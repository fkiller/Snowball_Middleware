import sqlite3, json, sys, os
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

result = {
    'antigravity': {},
    'opencode': {},
    'turns': {}
}

# 1. ANTIGRAVITY
try:
    import shutil
    agy_app_db = os.path.expanduser(r'~/.gemini/antigravity/conversation_summaries.db')
    agy_cli_db = os.path.expanduser(r'~/.gemini/antigravity-cli/conversation_summaries.db')
    agy_app_brain = os.path.expanduser(r'~/.gemini/antigravity/brain')
    agy_cli_brain = os.path.expanduser(r'~/.gemini/antigravity-cli/brain')

    db_entries = {}

    # Read cli db first
    if os.path.exists(agy_cli_db):
        con_cli = sqlite3.connect(Path(agy_cli_db).as_uri() + '?mode=ro', uri=True)
        cur_cli = con_cli.cursor()
        cur_cli.execute('SELECT conversation_id, title, preview, workspace_uris, project_id, last_modified_time FROM conversation_summaries ORDER BY last_modified_time DESC;')
        for cid, title, prev, uris_str, pid, mtime in cur_cli.fetchall():
            db_entries[cid] = {
                'cid': cid, 'title': title, 'prev': prev, 'uris_str': uris_str,
                'pid': pid, 'mtime': mtime, 'source_db': 'cli'
            }
        con_cli.close()

    # Read app db (takes precedence or updates)
    if os.path.exists(agy_app_db):
        con_app = sqlite3.connect(Path(agy_app_db).as_uri() + '?mode=ro', uri=True)
        cur_app = con_app.cursor()
        cur_app.execute('SELECT conversation_id, title, preview, workspace_uris, project_id, last_modified_time FROM conversation_summaries ORDER BY last_modified_time DESC;')
        for cid, title, prev, uris_str, pid, mtime in cur_app.fetchall():
            if cid not in db_entries or str(mtime or '') >= str(db_entries[cid].get('mtime') or ''):
                db_entries[cid] = {
                    'cid': cid, 'title': title, 'prev': prev, 'uris_str': uris_str,
                    'pid': pid, 'mtime': mtime, 'source_db': 'app'
                }
        con_app.close()

    # Sort conversations by last_modified_time descending
    sorted_convs = sorted(db_entries.values(), key=lambda x: str(x.get('mtime') or ''), reverse=True)

    for item in sorted_convs:
        cid = item['cid']
        title = item['title']
        prev = item['prev']
        uris_str = item['uris_str']

        uris = []
        try: uris = json.loads(uris_str)
        except: pass
        uri_first = uris[0] if isinstance(uris, list) and uris else ''

        from urllib.parse import urlparse, unquote
        parsed_uri = urlparse(uri_first)
        cwd = unquote(parsed_uri.path) if parsed_uri.scheme == 'file' else uri_first
        if os.name == 'nt' and len(cwd) > 2 and cwd[0] == '/' and cwd[2] == ':': cwd = cwd[1:]
        if not os.path.isabs(cwd): continue
        proj_name = os.path.basename(cwd.rstrip('/\\'))
        session_key = f'antigravity/{cid}'
        clean_title = title or prev or cid

        sess_model = None
        sess_effort = None

        # Load turns from transcript.jsonl if exists
        turns = []
        t1 = os.path.join(agy_app_brain, cid, '.system_generated', 'logs', 'transcript.jsonl')
        t2 = os.path.join(agy_cli_brain, cid, '.system_generated', 'logs', 'transcript.jsonl')
        transcript_path = t1 if os.path.exists(t1) else (t2 if os.path.exists(t2) else None)

        if transcript_path and os.path.exists(transcript_path):
            try:
                with open(transcript_path, 'r', encoding='utf-8', errors='ignore') as f:
                    for line in f:
                        if not line.strip(): continue

                        step = json.loads(line)
                        if step.get('type') == 'USER_INPUT' and step.get('content'):
                            raw_c = str(step['content'])
                            if '<USER_REQUEST>' in raw_c and '</USER_REQUEST>' in raw_c:
                                text = raw_c.split('<USER_REQUEST>')[1].split('</USER_REQUEST>')[0].strip()
                            elif '<USER_REQUEST>' in raw_c:
                                text = raw_c.split('<USER_REQUEST>')[1].strip()
                            else:
                                text = raw_c.strip()
                            if text:
                                turns.append({'role': 'user', 'text': text[:800], 'userPrompt': text[:800], 'time': '최근'})
                        elif step.get('type') == 'PLANNER_RESPONSE':
                            text = str(step.get('content') or '').strip()
                            tools = [tc.get('toolAction') or tc.get('toolSummary') or tc.get('name') for tc in step.get('tool_calls', []) if tc]
                            proc = [t for t in tools if t]
                            if turns and turns[-1]['role'] == 'agent':
                                if proc:
                                    existing = set(turns[-1].get('processDetails', []))
                                    for pr in proc:
                                        if pr not in existing:
                                            turns[-1]['processDetails'].append(pr)
                                if text:
                                    if turns[-1]['agentResponse']:
                                        turns[-1]['agentResponse'] += '\n' + text[:800]
                                    else:
                                        turns[-1]['agentResponse'] = text[:800]
                                    turns[-1]['text'] = turns[-1]['agentResponse']
                            else:
                                if text or proc:
                                    turns.append({
                                        'role': 'agent',
                                        'text': text[:800] if text else (proc[0] if proc else ''),
                                        'agentResponse': text[:800],
                                        'time': '최근',
                                        'processDetails': proc[:5]
                                    })
            except: pass

        if proj_name not in result['antigravity']:
            result['antigravity'][proj_name] = []

        result['antigravity'][proj_name].append({
            'id': cid,
            'cwd': cwd,
            'sessionKey': session_key,
            'title': clean_title,
            'preview': prev or clean_title,
            'readOnly': True,
            'ownerId': None,
            'model': sess_model,
            'effort': sess_effort,
            'access': 'on-request'
        })
        result['turns'][session_key] = turns[-15:]
        result['turns'][cid] = turns[-15:]
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
                'preview': clean_title,
                'readOnly': True,
                'ownerId': None,
                'model': full_model_key,
                'displayName': disp_model,
                'effort': variant,
                'access': 'on-request'
            })
            
            # Load turns from message and part tables
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
                            turns.append({'role': 'user', 'text': combined_text[:800], 'userPrompt': combined_text[:800], 'time': '최근'})
                        elif role == 'assistant':
                            turns.append({'role': 'agent', 'text': combined_text[:800], 'agentResponse': combined_text[:800], 'time': '최근', 'processDetails': ['opencode-executed']})
                except: pass
                
            result['turns'][session_key] = turns[-15:]
            result['turns'][sid] = turns[-15:]
except Exception as e:
    sys.stderr.write(f'OpenCode scan error: {e}\n')

print(json.dumps(result, ensure_ascii=False))
