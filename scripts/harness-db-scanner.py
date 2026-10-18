import sqlite3, json, sys, os
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
projects_only = '--projects-only' in sys.argv[1:]

result = {
    'antigravity': {},
    'opencode': {},
    'turns': {}
}

# 1. ANTIGRAVITY — desktop sidebar membership, not a union of archives.
try:
    from importlib import import_module
    scan_antigravity = import_module('antigravity-navigation').scan_antigravity
    sessions, turns, projects = scan_antigravity(read_turns=not projects_only)
    result['antigravity'] = sessions
    result['turns'].update(turns)
    result['antigravityProjects'] = projects
except Exception as e:
    sys.stderr.write(f'Antigravity scan error: {e}\n')

# 2. OPENCODE
try:
    oc_db = os.path.expanduser(r'~/.local/share/opencode/opencode.db')
    oc_cache_path = os.path.expanduser(r'~/.cache/opencode/models.json')
    oc_models_cache = {}
    if os.path.exists(oc_cache_path):
        try:
            with open(oc_cache_path, 'r', encoding='utf-8') as cf:
                oc_models_cache = json.load(cf)
        except: pass

    if os.path.exists(oc_db):
        con = sqlite3.connect(Path(oc_db).as_uri() + '?mode=ro', uri=True)
        cur = con.cursor()
        cur.execute('SELECT s.id, s.title, s.directory, s.model, s.time_updated FROM session s ORDER BY s.time_updated DESC;')
        
        for sid, title, directory, model_str, tu in cur.fetchall():
            proj_name = 'Snowball_Control'
            dir_norm = (directory or '').replace('\\', '/')
            proj_name = os.path.basename(dir_norm)
            model_info = {}
            try: model_info = json.loads(model_str or '{}')
            except: pass
            
            model_id = model_info.get('id') or ''
            provider_id = model_info.get('providerID') or ''
            variant = model_info.get('variant')
            if variant == 'default': variant = 'xhigh'
            
            full_model_key = (f'{provider_id}/{model_id}' if provider_id and model_id else None)
            p_meta = oc_models_cache.get(provider_id, {}).get('models', {}).get(model_id, {})
            disp_model = p_meta.get('name') or model_id
            
            clean_title = (title or 'Session ' + sid[:8]).strip()
            session_key = f'host_minime/snowball.opencode/default/{sid}'
            
            if proj_name not in result['opencode']:
                result['opencode'][proj_name] = []
                
            result['opencode'][proj_name].append({
                'id': sid,
                'cwd': directory,
                'sessionKey': session_key,
                'title': clean_title,
                'updatedAt': tu,
                'preview': clean_title,
                'readOnly': True,
                'ownerId': None,
                'model': full_model_key,
                'displayName': disp_model,
                'effort': variant,
                'access': 'on-request'
            })
            
            # Load turns from message and part tables
            if projects_only:
                continue
            cur2 = con.cursor()
            cur2.execute('SELECT m.id, m.data FROM message m WHERE m.session_id = ? ORDER BY m.time_created', (sid,))
            turns = []
            for mid, mdata_str in cur2.fetchall():
                try:
                    mdata = json.loads(mdata_str)
                    role = mdata.get('role')
                    cur3 = con.cursor()
                    cur3.execute('SELECT p.data FROM part p WHERE p.message_id = ? ORDER BY p.time_created', (mid,))
                    text_parts = []
                    for (pdata_str,) in cur3.fetchall():
                        pdata = json.loads(pdata_str)
                        if pdata.get('type') == 'text' and pdata.get('text'):
                            text_parts.append(pdata['text'])
                    combined_text = '\n'.join(text_parts).strip()
                    if combined_text:
                        if role == 'user':
                            turns.append({'role': 'user', 'text': combined_text, 'userPrompt': combined_text, 'time': '최근'})
                        elif role == 'assistant':
                            turns.append({'role': 'agent', 'text': combined_text, 'agentResponse': combined_text, 'time': '최근', 'processDetails': ['opencode-executed']})
                except: pass
                
            result['turns'][session_key] = turns
            result['turns'][sid] = turns
except Exception as e:
    sys.stderr.write(f'OpenCode scan error: {e}\n')

print(json.dumps(result, ensure_ascii=False))
