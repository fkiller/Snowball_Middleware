# MK20 power-only input investigation (2026-09-12)

## Outcome

No MCU firmware was modified or flashed. The board-specific GD32/QMK source and a verified recovery image are still missing. The practical first workaround is an existing USB host that enumerates the MK20 hub and HID keyboard and keeps them active. This removes the USB connection to the development PC, but still needs a USB host device. Charger-only operation requires further diagnosis and likely MCU firmware changes.

## Evidence and limits

- User subsequently confirmed that MK20 is powered by a power bank and that no separate QMK source package is known.
- Follow-up internet search checked upstream QMK `keyboards/waveshare`: only `rp2040_keyboard_3` was listed, not MK20. Do not confuse unrelated ArcBoard MK20 or NXP MK20 projects with this product.
- Downloaded the linked public `MK Series Upper Computer Open Source_V1.0.zip` (758,887,616 bytes) to `%TEMP%/MK-Series-Upper-Computer-Open-Source-V1.0.zip` and inspected all 17 ZIP entries without executing its programs. Contents: Qt `OpenSourceLicenseDemo_V1.0` C++ sources/executable, `MK10_V1.0.img`, `MK20_V1.0.img`, and `PhoenixCardv4.2.7.7z.7z`. No QMK/GD32 source tree is included. The system images were not unpacked, flashed or verified as MCU recovery images.
- Public archive: https://drive.google.com/file/d/1qS40a-0cSG2P_2cOweIpzsvfAnGtDvF5/view ; linked by https://spotpear.com/wiki/MK20-Mechanical-Keyboard-0.85inch-LCD-2.8inch-Secondary-Screen.html . GitHub release assets are desktop Windows/macOS installers, not matching MCU source.
- User reports that physical input requires a host PC. Earlier HANDOFF.md reports charger-only failure and an external-upstream hub with Linux gadget and GD32 as sibling devices. This turn did not independently remeasure that hub topology or physical key events.
- Live Wi-Fi ADB to `192.168.1.248:5555` succeeded. Linux reports `5.4.61`, and `/sys/class/udc/*/state` reports `not attached`.
- Linux USB devices contain root hubs and Realtek `0bda:b711` Wi-Fi; no GD32 keyboard. Input devices are sunxi-keyboard, sunxi-gpadc0, sunxi-ir and the audio jack.
- This supports separating Linux/network health from MCU input health. It does NOT prove GD32 deep sleep, an exact MCU part number, or the precise USB state causing the failure.
- Existing HUD initialization success messages are not proof of MCU acknowledgement: with an existing keymap backup, startup writes mappings without readback.
- The supplied `Keyboard_T113_SourceCode_20260427_MK20` SDK documents a Tina Linux build. Filename searches found no board QMK tree (`keymap.c`, QMK/GD32-named sources). `package/PCMonitorApp/src/serial.c` implements the Linux side of the custom UART protocol, including `0x16` events and a bootloader-jump request. A request function alone does not establish a usable DFU recovery procedure.
- The public Waveshare-ScreenKey GitHub `main` tree currently contains only README.md. Public searches did not locate a matching Waveshare MK20 MCU source release. This is not a claim that no source is obtainable from support.
- `mk20-plus.bin` under the SDK boot-resource directory starts with repeating `40 08` bytes, not a plausible ordinary Cortex-M vector table. Its name is not evidence that it is a GD32 flash image; do not use it as recovery firmware.
- The worktree already contained extensive tracked and untracked application changes on entry. They were preserved. The earlier handoff's clean-state statement is inaccurate.

## Options, in recommended order

1. **Existing Linux USB host / capable router:** connect MK20 using a data cable. Verify the hub and keyboard enumerate, available port power is sufficient, and inputs continue over Wi-Fi. Router compatibility is not guaranteed simply because it has a USB socket. If autosuspend causes a later failure, disable it for the identified MK20 hub/device, not globally. A powered hub alone, charger or passive OTG adapter cannot replace the host.
2. **Manufacturer standalone firmware:** ask whether an existing build or documented runtime command keeps matrix, encoder and UART processing active without USB enumeration. This is easier than maintaining a fork.
3. **MK20-specific QMK rebuild:** obtain the exact source/build target and rollback procedure, reproduce the stock build, then remove USB dependence from local input processing.
4. **Small embedded USB host:** TinyUSB supports hubs and HID, so a compatible host-capable MCU board is a possible workaround. It requires firmware, hub/composite-device testing and adequate VBUS power; it is not a proven plug-and-play MK20 fix.

Switching the T113 USB role is not a demonstrated software-only solution. If the documented sibling-port topology is correct, a downstream port cannot become the upstream connection merely through an OS setting; confirm a schematic/mux path first.

## QMK change scope once source is available

Upstream ChibiOS has two separate gates: `USB_WAIT_FOR_ENUMERATION` during initialization and a suspend loop guarded by `NO_USB_STARTUP_CHECK` during normal tasks. The vendor backend/version must be inspected before applying these options.

- Disable indefinite enumeration wait for this board.
- Keep matrix scanning, debounce, both encoder processing and UART RX/TX scheduled while USB is absent or suspended.
- Check that timers do not depend on USB SOF, and that HID send functions cannot block those tasks indefinitely without a host.
- Preserve the UART frame and `0x16` event protocol, VIA mappings, USB identity and bootloader region.
- On reconnect, synchronize HID state to avoid stuck keys or replaying old offline input.
- A `NO_USB_STARTUP_CHECK` setting is a candidate, not a verified one-line fix. Disabling only deep sleep may still leave execution inside a suspend loop.

Acceptance requires cold boot from a charger, all 20 press/release pairs, both knobs and clicks, prolonged idle, hot unplug/replug, PC suspend/resume, and UART commands under both power arrangements. Existing host unit tests cannot prove these hardware behaviors.

## Manufacturer request draft (not sent)

Subject: MK20 GD32/QMK source and operation without USB host

We have the Keyboard_T113_SourceCode_20260427_MK20 Linux SDK. Our application uses the internal 115200-baud UART to receive key and encoder events (custom command 0x16). Linux/Wi-Fi work with charger-only power, but physical input is reported to stop without an external USB host.

Please provide either a supported standalone firmware/runtime setting or the complete matching MK20 GD32/QMK source, including vendor USB backend, board revision and exact MCU, matrix/encoder/UART pin definitions, build target and toolchain, linker layout, bootloader/update instructions, and stock recovery firmware. Please confirm whether scanning or UART processing waits for USB enumeration or stops on USB suspend. We need local input to continue while USB is disconnected, with normal HID operation when USB is attached. Please also provide the USB hub/mux schematic if the T113 can host the internal keyboard without rewiring.

## Sources

- QMK options: https://docs.qmk.fm/config_options
- QMK USB properties: https://docs.qmk.fm/reference_info_json
- ChibiOS task/initialization gates: https://github.com/qmk/qmk_firmware/blob/master/tmk_core/protocol/chibios/chibios.c
- Vendor repository: https://github.com/waveshareteam/Waveshare-ScreenKey
- Linux USB autosuspend: https://docs.kernel.org/driver-api/usb/power-management.html
- Embedded host hub/HID example: https://docs.tinyusb.org/en/latest/examples/host/cdc_msc_hid.html

## Exact next action

Power-bank operation is confirmed by the user. With an available alternate host, compare charger-only and enumerated-host physical UART events using one UART reader; do not run a competing reader alongside the HUD. Obtain the vendor source and recovery package before preparing a flashable build. No flash, bootloader jump, reset, USB role change or service restart was performed in this investigation.
