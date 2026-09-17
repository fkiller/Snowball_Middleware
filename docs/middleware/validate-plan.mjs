import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const plan = JSON.parse(fs.readFileSync(path.join(directory, 'PLAN.json'), 'utf8'));
const nodes = plan.nodes;
const byId = new Map(nodes.map(node => [node.id, node]));
const errors = [];
const assert = (condition, message) => { if (!condition) errors.push(message); };
const children = id => nodes.filter(node => node.parent === id);
const tasks = nodes.filter(node => node.depth === 4);
const checks = nodes.filter(node => node.depth === 5);
const requirements = new Set(plan.requirements.map(req => req.id));
const taskStates = new Set(['todo', 'ready', 'in_progress', 'blocked', 'needs_review', 'done']);
const checkStates = new Set(['pending', 'pass', 'fail', 'blocked']);
const knownScenarios = new Set([...fs.readFileSync(path.join(directory, plan.scenarioCatalog), 'utf8').matchAll(/^\| ((?:H|D|J)\d{2}) \|/gm)].map(match => match[1]));
const coveredScenarios = new Set();
assert(plan.schemaVersion === 1, 'Unsupported schemaVersion');
assert(byId.size === nodes.length, 'Duplicate node ID');
assert(nodes.filter(node => node.parent === null).length === 1 && byId.get('MW')?.depth === 0, 'Expected one MW root');
assert(byId.get(plan.resumeTaskId)?.depth === 4, 'resumeTaskId must reference an L4 task');
assert(knownScenarios.size > 0, 'No discovery scenarios found');

for (const node of nodes) {
  assert(node.title?.length > 0, `${node.id}: missing title`);
  assert(Number.isInteger(node.depth) && node.depth >= 0 && node.depth <= 5, `${node.id}: invalid depth`);
  if (node.depth > 0) {
    const parent = byId.get(node.parent);
    assert(parent?.depth === node.depth - 1, `${node.id}: missing/wrong-depth parent`);
    assert(node.id.startsWith(`${node.parent}.`), `${node.id}: ID does not extend parent`);
  }
  for (const requirement of node.requirements ?? []) assert(requirements.has(requirement), `${node.id}: unknown requirement ${requirement}`);
  if (node.depth < 4) {
    assert(!('status' in node), `${node.id}: parent status must be derived`);
    assert(children(node.id).length > 0, `${node.id}: empty parent`);
  }
  if (node.depth === 4) {
    assert(taskStates.has(node.status), `${node.id}: invalid task status`);
    for (const key of ['designDemand', 'implementationDifficulty']) assert(Number.isInteger(node.priority?.[key]) && node.priority[key] >= 1 && node.priority[key] <= 5, `${node.id}: missing 1–5 priority.${key}`);
    for (const field of ['inputs', 'outputs', 'steps']) assert(Array.isArray(node[field]) && node[field].length > 0, `${node.id}: missing ${field}`);
    assert(node.checkpoint?.nextAction?.length > 0, `${node.id}: missing exact next action`);
    assert(Array.isArray(node.checkpoint?.changedFiles) && Array.isArray(node.checkpoint?.blockers), `${node.id}: incomplete checkpoint`);
    if (node.status === 'blocked') assert(node.checkpoint.blockers.length > 0, `${node.id}: blocked without reason`);
    if (['in_progress', 'done'].includes(node.status)) {
      assert(node.checkpoint.owner && node.checkpoint.baseCommit && node.checkpoint.updatedAt, `${node.id}: active/completed task lacks checkpoint identity`);
    }
    for (const dep of node.dependsOn) {
      assert(byId.get(dep)?.depth === 4 && dep !== node.id, `${node.id}: invalid dependency ${dep}`);
      if (['ready', 'in_progress', 'done'].includes(node.status)) assert(byId.get(dep)?.status === 'done', `${node.id}: unmet dependency ${dep}`);
    }
    const acceptance = children(node.id);
    assert(acceptance.length > 0, `${node.id}: no acceptance checks`);
    if (node.status === 'done') assert(acceptance.every(check => check.status === 'pass'), `${node.id}: done with incomplete acceptance`);
    for (const scenario of node.scenarios) {
      assert(knownScenarios.has(scenario), `${node.id}: unknown scenario ${scenario}`);
      coveredScenarios.add(scenario);
    }
  }
  if (node.depth === 5) {
    assert(checkStates.has(node.status), `${node.id}: invalid check status`);
    assert(Array.isArray(node.evidence), `${node.id}: missing evidence array`);
    if (node.status === 'pass') {
      assert(node.evidence.length > 0, `${node.id}: pass without evidence`);
      for (const evidence of node.evidence) {
        for (const field of ['date', 'environment', 'procedure', 'result', 'reference']) assert(typeof evidence[field] === 'string' && evidence[field].length > 0, `${node.id}: evidence missing ${field}`);
      }
    }
  }
}
for (const scenario of knownScenarios) assert(coveredScenarios.has(scenario), `Unmapped scenario ${scenario}`);

const visiting = new Set();
const visited = new Set();
function visit(id) {
  if (visiting.has(id)) { errors.push(`Dependency cycle at ${id}`); return; }
  if (visited.has(id)) return;
  visiting.add(id);
  for (const dep of byId.get(id)?.dependsOn ?? []) visit(dep);
  visiting.delete(id);
  visited.add(id);
}
tasks.forEach(task => visit(task.id));

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

function inheritedRequirements(node) {
  return [...new Set([...(node.requirements ?? []), ...(node.parent ? inheritedRequirements(byId.get(node.parent)) : [])])];
}
function status(node) {
  if (node.depth >= 4) return node.status;
  const descendants = tasks.filter(task => task.id.startsWith(`${node.id}.`));
  const done = descendants.filter(task => task.status === 'done').length;
  return `${done}/${descendants.length} tasks done`;
}
const args = process.argv.slice(2);
if (args.includes('--tree') || args.includes('--write-tree')) {
  const lines = ['# Middleware task tree', '', 'Generated from PLAN.json. Edit the ledger, then run `node docs/middleware/validate-plan.mjs --write-tree`.', '', 'Depth: L0 product → L1 outcome → L2 journey → L3 work package → L4 task → L5 acceptance.', '', 'All implementation checks are pending unless their evidence says otherwise.', ''];
  function render(node) {
    lines.push(`${'  '.repeat(node.depth)}- **${node.id}** ${node.title} — ${status(node)}`);
    for (const child of children(node.id)) render(child);
  }
  render(byId.get('MW'));
  const result = `${lines.join('\n')}\n`;
  if (args.includes('--write-tree')) fs.writeFileSync(path.join(directory, 'TASK_TREE.md'), result, 'utf8');
  else console.log(result);
} else if (args.includes('--affected')) {
  const requirement = args[args.indexOf('--affected') + 1];
  if (!requirements.has(requirement)) throw new Error(`Unknown requirement: ${requirement}`);
  for (const task of tasks.filter(task => inheritedRequirements(task).includes(requirement))) console.log(`${task.id} [${task.status}] ${task.title}`);
} else {
  console.log(`Valid: ${nodes.length} nodes, ${tasks.length} tasks, ${checks.length} acceptance checks, ${coveredScenarios.size}/${knownScenarios.size} discovery scenarios mapped.`);
  console.log(`Implementation: ${tasks.filter(task => task.status === 'done').length}/${tasks.length} tasks done; ${checks.filter(check => check.status === 'pass').length}/${checks.length} checks passed.`);
  if (args.includes('--next')) {
    const resume = byId.get(plan.resumeTaskId);
    console.log(`Resume checkpoint: ${resume.id} [${resume.status}] ${resume.checkpoint.nextAction}`);
    const eligible = tasks.filter(task => ['todo', 'ready'].includes(task.status) && task.dependsOn.every(dep => byId.get(dep).status === 'done'))
      .sort((a, b) => b.priority.designDemand - a.priority.designDemand || b.priority.implementationDifficulty - a.priority.implementationDifficulty || a.id.localeCompare(b.id));
    for (const task of eligible) console.log(`Eligible: ${task.id} — ${task.title}\n  Next: ${task.checkpoint.nextAction}`);
    const unfinished = tasks.filter(task => ['in_progress', 'blocked', 'needs_review'].includes(task.status));
    for (const task of unfinished) console.log(`Review checkpoint: ${task.id} [${task.status}] ${task.checkpoint.nextAction}`);
  }
}
