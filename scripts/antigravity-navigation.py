"""Read Antigravity's actual desktop project and top-level conversation state."""
import json
import os
import re
import sqlite3
from pathlib import Path
from urllib.parse import unquote, urlparse


def local_folder(uri):
    if not isinstance(uri, str):
        return ''
    parsed = urlparse(uri)
    if parsed.scheme == 'file':
        # Antigravity has emitted both file:///c%3A/... and file://C:/... .
        value = unquote((parsed.netloc + parsed.path) if parsed.netloc else parsed.path)
        if len(value) > 2 and value[0] == '/' and value[2] == ':':
            value = value[1:]
    else:
        value = uri
    return os.path.normpath(value) if os.path.isabs(value) else ''


def desktop_projects(home, appdata):
    definitions = {}
    directory = Path(home) / '.gemini/config/projects'
    if directory.exists():
        for file in sorted(directory.glob('*.json')):
            try:
                data = json.loads(file.read_text(encoding='utf-8'))
                definitions[data['id']] = data
            except (OSError, ValueError, KeyError):
                continue
    order = []
    try:
        storage = json.loads((Path(appdata) / 'Antigravity/app_storage.json').read_text(encoding='utf-8'))
        order = storage.get('projectsOrder', [])
        if isinstance(order, str):
            order = json.loads(order)
        if not isinstance(order, list):
            order = []
    except (OSError, ValueError):
        pass
    ids = list(dict.fromkeys([*order, *definitions]))
    projects = []
    for pid in ids:
        data = definitions.get(pid)
        if not data:
            continue
        resources = data.get('projectResources', {}).get('resources', [])
        roots = [local_folder(resource.get('gitFolder', {}).get('folderUri')) for resource in resources]
        root = next((root for root in roots if root and os.path.isdir(root)), '')
        if root:
            projects.append({'candidateId': 'ag_' + pid, 'nativeProjectId': pid,
                             'displayName': data.get('name') or os.path.basename(root), 'root': root,
                             'harness': {'pluginId': 'snowball.antigravity', 'instanceId': 'default'}})
    return projects, definitions


def transcript_turns(file):
    turns = []
    if not file.exists():
        return turns
    with file.open(encoding='utf-8', errors='replace') as stream:
        for line in stream:
            try:
                step = json.loads(line)
            except ValueError:
                # An in-progress/malformed line must not discard subsequent records.
                continue
            text = str(step.get('content') or '').strip()
            if step.get('type') == 'USER_INPUT':
                if '<USER_REQUEST>' in text:
                    text = text.split('<USER_REQUEST>', 1)[1].split('</USER_REQUEST>', 1)[0].strip()
                if text:
                    turns.append({'role': 'user', 'text': text, 'userPrompt': text, 'time': step.get('created_at') or ''})
            elif step.get('type') == 'PLANNER_RESPONSE':
                tools = [tool.get('toolAction') or tool.get('toolSummary') or tool.get('name')
                         for tool in step.get('tool_calls', []) if isinstance(tool, dict)]
                tools = [tool for tool in tools if isinstance(tool, str) and tool]
                if turns and turns[-1]['role'] == 'agent':
                    last = turns[-1]
                    last['processDetails'] = list(dict.fromkeys([*last['processDetails'], *tools]))
                    if text:
                        last['agentResponse'] = '\n'.join(filter(None, [last['agentResponse'], text]))
                        last['text'] = last['agentResponse']
                elif text or tools:
                    turns.append({'role': 'agent', 'text': text or tools[0], 'agentResponse': text,
                                  'time': step.get('created_at') or '', 'processDetails': tools})
    return turns


def scan_antigravity(home=None, appdata=None, read_turns=True):
    home = Path(home or Path.home())
    appdata = Path(appdata or os.environ.get('APPDATA') or home / '.config')
    projects, definitions = desktop_projects(home, appdata)
    by_id = {project['nativeProjectId']: project for project in projects}
    desktop = home / '.gemini/antigravity'
    # A separate CLI archive is not the desktop's sidebar, even when newer.
    source = desktop if (desktop / 'conversation_summaries.db').exists() else home / '.gemini/antigravity-cli'
    db = source / 'conversation_summaries.db'
    sessions, turns_store = {}, {}
    if not db.exists():
        return sessions, turns_store, projects
    connection = sqlite3.connect(db.as_uri() + '?mode=ro', uri=True)
    connection.row_factory = sqlite3.Row
    try:
        columns = {row[1] for row in connection.execute('PRAGMA table_info(conversation_summaries)')}
        activity = "COALESCE(NULLIF(last_user_input_time,''),last_modified_time)" if 'last_user_input_time' in columns else 'last_modified_time'
        rows = connection.execute(f'SELECT * FROM conversation_summaries ORDER BY {activity} DESC, last_modified_time DESC')
        seen = set()
        for row in rows:
            item = dict(row)
            cid = item['conversation_id']
            if not isinstance(cid, str) or not re.fullmatch(r'[0-9a-fA-F-]{8,64}', cid):
                continue
            if cid in seen or item.get('parent_conversation_id') or item.get('nesting_depth', 0):
                continue
            if source == desktop and item.get('app_data_dir') not in (None, '', 'antigravity'):
                continue
            seen.add(cid)
            try:
                uris = json.loads(item['workspace_uris'])
                cwd = local_folder(uris[0]) if isinstance(uris, list) and uris else ''
            except (ValueError, TypeError):
                cwd = ''
            if not cwd:
                continue
            pid = item.get('project_id')
            project = by_id.get(pid)
            # Deleted project records must not re-create a sidebar project.
            if definitions and pid and pid not in definitions and pid != 'outside-of-project':
                continue
            name = project['displayName'] if project else os.path.basename(cwd.rstrip('/\\'))
            session_key = 'antigravity/' + cid
            title = item.get('title') or item.get('preview') or cid
            session = {'id': cid, 'cwd': cwd, 'sessionKey': session_key, 'title': title,
                       'updatedAt': item.get('last_modified_time'), 'preview': item.get('preview') or title,
                       'readOnly': True, 'ownerId': None, 'model': None, 'effort': None, 'access': 'on-request'}
            if project:
                session.update(projectRoot=project['root'], projectName=name, nativeProjectId=pid)
            sessions.setdefault(name, []).append(session)
            # Read the matching source only; never substitute another archive's transcript.
            file = source / 'brain' / cid / '.system_generated/logs/transcript.jsonl'
            turns = transcript_turns(file) if read_turns else []
            turns_store[session_key] = turns
            turns_store[cid] = turns
    finally:
        connection.close()
    return sessions, turns_store, projects
