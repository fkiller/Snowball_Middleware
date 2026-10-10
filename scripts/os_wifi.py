"""Read only the currently connected OS Wi-Fi. Secrets stay in this process.

Windows uses the native WLAN API (no localized netsh output). macOS uses the
OS network/keychain utilities and may require user permission. No saved-network
inventory is exported, and enterprise credentials are never migrated.
"""
import ctypes as C
import json
import subprocess
import sys
import xml.etree.ElementTree as ET

def profile_credentials(xml, expected_ssid):
    root = ET.fromstring(xml)
    get = lambda path: root.findtext(path, namespaces={'w': 'http://www.microsoft.com/networking/WLAN/profile/v1'})
    ssid = get('w:SSIDConfig/w:SSID/w:name')
    if ssid != expected_ssid or get('w:MSM/w:security/w:authEncryption/w:useOneX') == 'true':
        raise RuntimeError('wifi_profile_unavailable')
    if get('w:MSM/w:security/w:authEncryption/w:authentication') == 'open' and get('w:MSM/w:security/w:authEncryption/w:encryption') == 'none':
        return ''
    if get('w:MSM/w:security/w:sharedKey/w:protected') != 'false' or get('w:MSM/w:security/w:sharedKey/w:keyType') != 'passPhrase':
        raise RuntimeError('wifi_key_permission_required')
    password = get('w:MSM/w:security/w:sharedKey/w:keyMaterial')
    if not password or not 8 <= len(password.encode('utf-8')) <= 63:
        raise RuntimeError('wifi_key_unavailable')
    return password

def windows_wifi(secret):
    from ctypes import wintypes as W
    class GUID(C.Structure):
        _fields_ = [('a', W.DWORD), ('b', W.WORD), ('c', W.WORD), ('d', C.c_ubyte * 8)]
    class Interface(C.Structure):
        _fields_ = [('guid', GUID), ('description', W.WCHAR * 256), ('state', W.DWORD)]
    class SSID(C.Structure):
        _fields_ = [('size', W.ULONG), ('bytes', C.c_ubyte * 32)]
    class Association(C.Structure):
        _fields_ = [('ssid', SSID), ('bssType', W.DWORD), ('bssid', C.c_ubyte * 6), ('phyType', W.DWORD), ('phyIndex', W.ULONG), ('signal', W.ULONG), ('rx', W.ULONG), ('tx', W.ULONG)]
    class Security(C.Structure):
        _fields_ = [('enabled', W.BOOL), ('oneX', W.BOOL), ('auth', W.DWORD), ('cipher', W.DWORD)]
    class Connection(C.Structure):
        _fields_ = [('state', W.DWORD), ('mode', W.DWORD), ('profile', W.WCHAR * 256), ('association', Association), ('security', Security)]
    dll = C.WinDLL('wlanapi')
    dll.WlanOpenHandle.argtypes = [W.DWORD, C.c_void_p, C.POINTER(W.DWORD), C.POINTER(W.HANDLE)]
    dll.WlanEnumInterfaces.argtypes = [W.HANDLE, C.c_void_p, C.POINTER(C.c_void_p)]
    dll.WlanQueryInterface.argtypes = [W.HANDLE, C.POINTER(GUID), W.DWORD, C.c_void_p, C.POINTER(W.DWORD), C.POINTER(C.c_void_p), C.c_void_p]
    dll.WlanGetProfile.argtypes = [W.HANDLE, C.POINTER(GUID), W.LPCWSTR, C.c_void_p, C.POINTER(C.c_void_p), C.POINTER(W.DWORD), C.POINTER(W.DWORD)]
    dll.WlanFreeMemory.argtypes = [C.c_void_p]
    dll.WlanCloseHandle.argtypes = [W.HANDLE, C.c_void_p]
    handle, negotiated = W.HANDLE(), W.DWORD()
    if dll.WlanOpenHandle(2, None, C.byref(negotiated), C.byref(handle)):
        raise RuntimeError('wifi_permission_or_service_unavailable')
    pointer = C.c_void_p()
    try:
        if dll.WlanEnumInterfaces(handle, None, C.byref(pointer)):
            raise RuntimeError('wifi_permission_or_service_unavailable')
        count = C.cast(pointer, C.POINTER(W.DWORD))[0]
        if count > 32:
            raise RuntimeError('wifi_interfaces_invalid')
        interfaces = C.cast(pointer.value + 8, C.POINTER(Interface))
        connected = [interfaces[i] for i in range(count) if interfaces[i].state == 1]
        if len(connected) != 1:
            raise RuntimeError('wifi_not_connected_or_ambiguous')
        interface = connected[0]
        connection, size = C.c_void_p(), W.DWORD()
        if dll.WlanQueryInterface(handle, C.byref(interface.guid), 7, None, C.byref(size), C.byref(connection), None):
            raise RuntimeError('wifi_permission_or_service_unavailable')
        try:
            data = C.cast(connection, C.POINTER(Connection)).contents
            if data.association.ssid.size > 32:
                raise RuntimeError('wifi_ssid_invalid')
            ssid = bytes(data.association.ssid.bytes[:data.association.ssid.size]).decode('utf-8')
            profile = str(data.profile)
            enterprise = bool(data.security.oneX)
        finally:
            dll.WlanFreeMemory(connection)
        result = {'ssid': ssid, 'platform': 'win32', 'enterprise': enterprise}
        if secret:
            if enterprise:
                raise RuntimeError('wifi_enterprise_unsupported')
            xml, flags, access = C.c_void_p(), W.DWORD(4), W.DWORD()
            if dll.WlanGetProfile(handle, C.byref(interface.guid), profile, None, C.byref(xml), C.byref(flags), C.byref(access)):
                raise RuntimeError('wifi_key_permission_required')
            try:
                result['password'] = profile_credentials(C.wstring_at(xml), ssid)
            finally:
                dll.WlanFreeMemory(xml)
        return result
    finally:
        if pointer:
            dll.WlanFreeMemory(pointer)
        dll.WlanCloseHandle(handle, None)

def mac_wifi(secret):
    def run(argv):
        return subprocess.run(argv, check=True, capture_output=True, text=True, timeout=60).stdout.rstrip('\r\n')
    devices = run(['/usr/sbin/networksetup', '-listallhardwareports'])
    names = []
    for block in devices.split('\n\n'):
        if 'Hardware Port: Wi-Fi' in block or 'Hardware Port: AirPort' in block:
            names += [line.split(': ', 1)[1] for line in block.splitlines() if line.startswith('Device: ')]
    if len(names) != 1:
        raise RuntimeError('wifi_not_connected_or_ambiguous')
    network = run(['/usr/sbin/networksetup', '-getairportnetwork', names[0]])
    prefix = 'Current Wi-Fi Network: '
    if not network.startswith(prefix):
        raise RuntimeError('wifi_permission_or_service_unavailable')
    result = {'ssid': network[len(prefix):], 'platform': 'darwin', 'enterprise': False}
    if secret:
        result['password'] = run(['/usr/bin/security', 'find-generic-password', '-D', 'AirPort network password', '-a', result['ssid'], '-w'])
    return result

def current_wifi(secret=False):
    if sys.platform == 'win32':
        result = windows_wifi(secret)
    elif sys.platform == 'darwin':
        result = mac_wifi(secret)
    else:
        raise RuntimeError('wifi_os_unsupported')
    if not result['ssid'] or len(result['ssid'].encode('utf-8')) > 32:
        raise RuntimeError('wifi_ssid_invalid')
    return result
