import hashlib
import importlib
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
scan = importlib.import_module('antigravity-navigation').scan_antigravity


class AntigravityNavigationTest(unittest.TestCase):
    def test_desktop_membership_order_full_text_and_read_only_sources(self):
        with tempfile.TemporaryDirectory() as temp:
            home = Path(temp)
            appdata = home / 'appdata'
            root = home / 'project'
            worktree = home / 'worktree'
            other = home / 'other'
            for directory in [root, worktree, other]:
                directory.mkdir()
            definitions = home / '.gemini/config/projects'
            definitions.mkdir(parents=True)
            for pid, folder in [('p1', root), ('p2', other)]:
                (definitions / (pid + '.json')).write_text(json.dumps({
                    'id': pid, 'name': pid, 'projectResources': {'resources': [{'gitFolder': {'folderUri': folder.as_uri()}}]}
                }), encoding='utf-8')
            (appdata / 'Antigravity').mkdir(parents=True)
            (appdata / 'Antigravity/app_storage.json').write_text(json.dumps({'projectsOrder': '["p2","p1"]'}), encoding='utf-8')
            desktop = home / '.gemini/antigravity'
            cli = home / '.gemini/antigravity-cli'
            for source in [desktop, cli]:
                source.mkdir()
                connection = sqlite3.connect(source / 'conversation_summaries.db')
                connection.execute('CREATE TABLE conversation_summaries(conversation_id TEXT PRIMARY KEY, title TEXT, preview TEXT, workspace_uris TEXT, project_id TEXT, last_modified_time TEXT, last_user_input_time TEXT, parent_conversation_id TEXT, nesting_depth INT, killed INT, app_data_dir TEXT)')
                rows = [
                    ('00000001', 'Same title', '', json.dumps([worktree.as_uri()]), 'p1', '2026-01-04', '2026-01-03', '', 0, 0, 'antigravity'),
                    ('00000002', 'Same title', '', json.dumps([root.as_uri()]), 'p1', '2026-01-05', '2026-01-02', '', 0, 0, 'antigravity'),
                    ('00000003', 'Same title', '', json.dumps([root.as_uri()]), 'p1', '2026-01-06', '2026-01-04', '00000001', 1, 0, 'antigravity'),
                    ('00000004', 'Killed', '', json.dumps([root.as_uri()]), 'p1', '2026-01-06', '2026-01-04', '', 0, 1, 'antigravity'),
                    ('00000005', 'Foreign CLI copy', '', json.dumps([root.as_uri()]), 'p1', '2026-01-06', '2026-01-04', '', 0, 0, 'antigravity-cli'),
                    ('00000006', 'Deleted project', '', json.dumps([root.as_uri()]), 'deleted', '2026-01-06', '2026-01-04', '', 0, 0, 'antigravity'),
                ]
                if source == cli:
                    rows = [('00000007', 'CLI only', '', json.dumps([root.as_uri()]), 'p1', '2026-01-07', '2026-01-07', '', 0, 0, 'antigravity-cli')]
                connection.executemany('INSERT INTO conversation_summaries VALUES (?,?,?,?,?,?,?,?,?,?,?)', rows)
                connection.commit()
                connection.close()
            transcript = desktop / 'brain/00000001/.system_generated/logs/transcript.jsonl'
            transcript.parent.mkdir(parents=True)
            long_text = '# Full answer\n' + '한글 본문 ' * 700 + '\n**last line preserved**'
            records = []
            for index in range(18):
                records.extend([{'type': 'USER_INPUT', 'content': f'<USER_REQUEST>Question {index}</USER_REQUEST>'}, {'type': 'PLANNER_RESPONSE', 'content': long_text}])
            transcript.write_text('\n'.join(json.dumps(record, ensure_ascii=False) for record in records) + '\n{unfinished\n' + json.dumps({'type': 'PLANNER_RESPONSE', 'content': 'after malformed line'}), encoding='utf-8')
            before = hashlib.sha256((desktop / 'conversation_summaries.db').read_bytes()).digest()
            sessions, turns, projects = scan(home, appdata)
            self.assertEqual([project['nativeProjectId'] for project in projects], ['p2', 'p1'])
            # A stopped top-level conversation is still native history, unlike a child.
            self.assertEqual([item['id'] for item in sessions['p1']], ['00000004', '00000001', '00000002'])
            self.assertEqual(sessions['p1'][1]['cwd'], str(worktree))
            self.assertEqual(sessions['p1'][1]['projectRoot'], str(root))
            self.assertEqual(len(turns['00000001']), 36)
            self.assertTrue(turns['00000001'][1]['text'].endswith('**last line preserved**'))
            self.assertTrue(turns['00000001'][-1]['text'].endswith('after malformed line'))
            self.assertEqual(before, hashlib.sha256((desktop / 'conversation_summaries.db').read_bytes()).digest())
            (desktop / 'conversation_summaries.db').unlink()
            cli_sessions, _, _ = scan(home, appdata, read_turns=False)
            self.assertEqual([item['id'] for item in cli_sessions['p1']], ['00000007'])


if __name__ == '__main__':
    unittest.main()
