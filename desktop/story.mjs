/** Pure story graph, validation and disposable runtime. Shared by renderer and worker. */
const fail = (message) => {
  throw new Error(message);
};
const object = (v, field) =>
  v && typeof v === "object" && !Array.isArray(v)
    ? v
    : fail(`${field} 必须是对象`);
const list = (v, field, max = 1000) =>
  Array.isArray(v) && v.length <= max
    ? v
    : fail(`${field} 必须是数组且不超过 ${max} 项`);
const text = (v, field, empty = false, max = 20000) =>
  typeof v === "string" && v.length <= max && (empty || v.trim())
    ? v
    : fail(`${field} 必须是${empty ? "" : "非空"}文本`);
const identifier = (v, field) =>
  typeof v === "string" &&
  /^[A-Za-z0-9_-]{1,128}$/.test(v) &&
  !["__proto__", "prototype", "constructor"].includes(v)
    ? v
    : fail(`${field} 标识无效`);
const scalar = (v, type, field) =>
  typeof v === type &&
  (type !== "number" || Number.isFinite(v)) &&
  (type !== "string" || v.length <= 20000)
    ? v
    : fail(`${field} 必须是有效的 ${type}`);
const pick = (v, values, field) =>
  values.includes(v) ? v : fail(`${field} 无效`);
const finite = (v, field) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0
    ? v
    : fail(`${field} 必须为非负有限数值`);
const unique = (items, field) => {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) fail(`${field} 存在重复标识 ${item.id}`);
    seen.add(item.id);
  }
  return items;
};

export function validateStory(input, snapshot) {
  object(input, "故事");
  const variables = unique(
    list(input.variables ?? [], "变量", 200).map((v) => {
      object(v, "变量");
      const type = pick(v.type, ["boolean", "number", "string"], "变量类型");
      return {
        id: identifier(v.id, "变量"),
        name: text(v.name, "变量名称", false, 200),
        type,
        initial: scalar(v.initial, type, "初始值"),
      };
    }),
    "变量",
  );
  const byVariable = new Map(variables.map((v) => [v.id, v]));
  const choiceIds = new Set();
  const nodes = unique(
    list(input.nodes, "节点", 1000).map((n) => {
      object(n, "节点");
      const result = {
        id: identifier(n.id, "节点"),
        title: text(n.title, "节点名称", false, 300),
        body: text(n.body ?? "", "节点内容", true),
        kind: pick(n.kind, ["scene", "clue", "ending"], "节点类型"),
        epistemic: pick(
          n.epistemic ?? "invented",
          ["observed", "interpreted", "invented"],
          "节点信息性质",
        ),
        eventIds: [
          ...new Set(
            list(n.eventIds ?? [], "事件").map((id) => identifier(id, "事件")),
          ),
        ],
        choices: [],
      };
      if (snapshot)
        for (const eventId of result.eventIds)
          if (!(snapshot.events ?? []).some((e) => e.id === eventId))
            fail(`节点引用不存在的事件：${eventId}`);
      if (n.mediaId !== undefined && n.mediaId !== "") {
        result.mediaId = identifier(n.mediaId, "素材");
        const media = snapshot?.media?.find((m) => m.id === n.mediaId);
        if (snapshot && !media) fail(`节点引用不存在的素材：${n.mediaId}`);
        result.start = finite(n.start ?? 0, "素材入点");
        result.end = finite(
          n.end ?? media?.duration ?? n.start ?? 0,
          "素材出点",
        );
        if (
          result.end < result.start ||
          (media && result.end > media.duration) ||
          (media?.kind === "image" && (result.start !== 0 || result.end !== 0))
        )
          fail("节点素材区间超出范围");
      } else if (n.start !== undefined || n.end !== undefined)
        fail("素材区间必须关联素材");
      result.choices = list(n.choices ?? [], "选项", 100).map((c) => {
        object(c, "选项");
        const id = identifier(c.id, "选项");
        if (choiceIds.has(id)) fail(`选项存在重复标识 ${id}`);
        choiceIds.add(id);
        return {
          id,
          label: text(c.label, "选项名称", false, 1000),
          targetId: identifier(c.targetId, "目标节点"),
          conditions: list(c.conditions ?? [], "条件", 100).map((condition) => {
            object(condition, "条件");
            const variable = byVariable.get(condition.variable);
            if (!variable) fail("条件引用不存在的变量");
            const operator = pick(
              condition.operator,
              ["eq", "ne", "gt", "gte", "lt", "lte"],
              "条件运算符",
            );
            if (!["eq", "ne"].includes(operator) && variable.type !== "number")
              fail("大小比较仅支持数值变量");
            return {
              variable: variable.id,
              operator,
              value: scalar(condition.value, variable.type, "条件值"),
            };
          }),
          effects: list(c.effects ?? [], "状态变化", 100).map((effect) => {
            object(effect, "状态变化");
            const variable = byVariable.get(effect.variable);
            if (!variable) fail("状态变化引用不存在的变量");
            const op = pick(effect.op, ["set", "add"], "状态操作");
            if (op === "add" && variable.type !== "number")
              fail("增加操作仅支持数值变量");
            return {
              variable: variable.id,
              op,
              value: scalar(effect.value, variable.type, "变化值"),
            };
          }),
        };
      });
      if (result.kind === "ending" && result.choices.length)
        fail("结局节点不能含有选项");
      return result;
    }),
    "节点",
  );
  if (!nodes.length) fail("故事至少需要一个节点");
  const nodeIds = new Set(nodes.map((n) => n.id));
  const startNodeId = identifier(input.startNodeId, "起始节点");
  if (!nodeIds.has(startNodeId)) fail("起始节点不存在");
  for (const node of nodes)
    for (const c of node.choices)
      if (!nodeIds.has(c.targetId)) fail(`选项目标节点不存在：${c.targetId}`);
  const result = {
    name: text(input.name, "故事名称", false, 300),
    description: text(input.description ?? "", "故事描述", true),
    variables,
    startNodeId,
    nodes,
  };
  if (input.id !== undefined) result.id = identifier(input.id, "故事");
  for (const field of ["createdAt", "updatedAt"])
    if (input[field] !== undefined)
      result[field] = text(input[field], field, false, 100);
  return result;
}

/** Structural diagnostics; conditional feasibility is shown during actual simulation. */
export function diagnoseStory(story) {
  const diagnostics = [];
  const nodes = new Map((story.nodes ?? []).map((n) => [n.id, n]));
  if (!nodes.has(story.startNodeId))
    diagnostics.push({
      severity: "error",
      code: "missing_start",
      message: "起始节点不存在",
    });
  for (const n of nodes.values()) {
    if (n.kind !== "ending" && !n.choices.length)
      diagnostics.push({
        severity: "warning",
        code: "dead_end",
        nodeId: n.id,
        message: `「${n.title}」不是结局且没有出路`,
      });
    for (const c of n.choices)
      if (!nodes.has(c.targetId))
        diagnostics.push({
          severity: "error",
          code: "dangling_target",
          nodeId: n.id,
          message: `「${n.title}」的选项目标不存在`,
        });
  }
  const reachable = new Set();
  const queue = [story.startNodeId];
  while (queue.length) {
    const id = queue.pop();
    if (reachable.has(id) || !nodes.has(id)) continue;
    reachable.add(id);
    for (const c of nodes.get(id).choices) queue.push(c.targetId);
  }
  for (const n of nodes.values())
    if (!reachable.has(n.id))
      diagnostics.push({
        severity: "warning",
        code: "unreachable",
        nodeId: n.id,
        message: `「${n.title}」无法从起点到达`,
      });
  // Tarjan's strongly connected components gives one report per cyclic group.
  let index = 0;
  const indices = new Map();
  const lows = new Map();
  const stack = [];
  const active = new Set();
  function visit(id) {
    indices.set(id, index);
    lows.set(id, index++);
    stack.push(id);
    active.add(id);
    for (const choice of nodes.get(id).choices) {
      const to = choice.targetId;
      if (!nodes.has(to)) continue;
      if (!indices.has(to)) {
        visit(to);
        lows.set(id, Math.min(lows.get(id), lows.get(to)));
      } else if (active.has(to))
        lows.set(id, Math.min(lows.get(id), indices.get(to)));
    }
    if (lows.get(id) === indices.get(id)) {
      const group = [];
      let member;
      do {
        member = stack.pop();
        active.delete(member);
        group.push(member);
      } while (member !== id);
      if (
        group.length > 1 ||
        nodes.get(id).choices.some((c) => c.targetId === id)
      )
        diagnostics.push({
          severity: "warning",
          code: "cycle",
          nodeId: id,
          nodeIds: group,
          message: `存在循环：${group.map((key) => nodes.get(key).title).join(" → ")}；预演最多 500 步`,
        });
    }
  }
  for (const id of nodes.keys()) if (!indices.has(id)) visit(id);
  return diagnostics;
}
const compare = (actual, operator, value) => {
  switch (operator) {
    case "eq":
      return actual === value;
    case "ne":
      return actual !== value;
    case "gt":
      return actual > value;
    case "gte":
      return actual >= value;
    case "lt":
      return actual < value;
    case "lte":
      return actual <= value;
    default:
      return false;
  }
};
function sessionFor(story, session) {
  object(session, "预演");
  object(session.values, "预演状态");
  if (
    !Number.isSafeInteger(session.steps) ||
    session.steps < 0 ||
    session.steps > 500
  )
    fail("预演步数无效");
  const node = story.nodes.find((n) => n.id === session.nodeId);
  if (!node) fail("预演节点不存在");
  const values = Object.fromEntries(
    story.variables.map((v) => [
      v.id,
      scalar(session.values[v.id], v.type, `预演变量 ${v.name}`),
    ]),
  );
  const history = list(session.history ?? [], "预演历史", 500).map((entry) => ({
    ...object(entry, "历史记录"),
  }));
  if (history.length !== session.steps) fail("预演历史与步数不一致");
  return { node, values, history };
}
export function beginStory(input) {
  const story = validateStory(input);
  return {
    nodeId: story.startNodeId,
    values: Object.fromEntries(story.variables.map((v) => [v.id, v.initial])),
    steps: 0,
    history: [],
  };
}
export function storyChoices(input, session) {
  const story = validateStory(input);
  const { node, values } = sessionFor(story, session);
  return node.choices.map((choice) => ({
    ...choice,
    available:
      session.steps < 500 &&
      choice.conditions.every((c) =>
        compare(values[c.variable], c.operator, c.value),
      ),
  }));
}
export function chooseStory(input, session, choiceId) {
  const story = validateStory(input);
  const { node, values, history } = sessionFor(story, session);
  if (session.steps >= 500) fail("达到 500 步预演上限，请重新开始");
  const choice = node.choices.find((c) => c.id === choiceId);
  if (!choice) fail("当前节点不存在此选项");
  if (
    !choice.conditions.every((c) =>
      compare(values[c.variable], c.operator, c.value),
    )
  )
    fail("选项条件尚未满足");
  for (const effect of choice.effects) {
    values[effect.variable] =
      effect.op === "set"
        ? effect.value
        : values[effect.variable] + effect.value;
    scalar(
      values[effect.variable],
      story.variables.find((v) => v.id === effect.variable).type,
      "状态变化结果",
    );
  }
  return {
    nodeId: choice.targetId,
    values,
    steps: session.steps + 1,
    history: [...history, { from: node.id, choiceId, to: choice.targetId }],
  };
}
const quote = (value) =>
  JSON.stringify(value)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
const say = (value) => quote(value.replace(/\[/g, "[[").replace(/\{/g, "{{"));

export function exportStory({ story: input, format, snapshot }) {
  const story = validateStory(input, snapshot);
  const filename = "cutbox-story";
  const envelope = {
    schema: "cutbox.story/0.1",
    story,
    diagnostics: diagnoseStory(story),
    media: (snapshot?.media ?? [])
      .filter((m) => story.nodes.some((n) => n.mediaId === m.id))
      .map(({ id, name, sha256, duration }) => ({
        id,
        name,
        sha256,
        duration,
      })),
    note: "Narrative exchange. Media references are IDs; original media must be exported and connected separately.",
  };
  if (format === "json")
    return {
      filename: `${filename}.json`,
      content: JSON.stringify(envelope, null, 2) + "\n",
    };
  if (format === "godot")
    return { filename: `${filename}.gd`, content: godotExport(story) };
  if (format !== "renpy") fail("不支持的故事导出格式");
  const labels = new Map(story.nodes.map((n, i) => [n.id, `cutbox_node_${i}`]));
  const lines = [
    "# CutBox narrative-only exchange. Put in game/ in a RenPy project.",
    "# Start with: call cutbox_start. Media IDs remain in the JSON export.",
    "init python:",
    "    import json as _cutbox_json",
    "    import math as _cutbox_math",
    `    _cutbox_story = _cutbox_json.loads(${quote(JSON.stringify(story))}, parse_int=float)`,
    "    def _cutbox_allowed(values, conditions):",
    "        for c in conditions:",
    '            a, b, op = values[c["variable"]], c["value"], c["operator"]',
    '            if not ({"eq": lambda: a == b, "ne": lambda: a != b, "gt": lambda: a > b, "gte": lambda: a >= b, "lt": lambda: a < b, "lte": lambda: a <= b}[op]()):',
    "                return False",
    "        return True",
    "    def _cutbox_apply(values, effects):",
    "        result = dict(values)",
    "        for e in effects:",
    '            key = e["variable"]',
    '            result[key] = e["value"] if e["op"] == "set" else result[key] + e["value"]',
    "            if isinstance(result[key], (int, float)) and not _cutbox_math.isfinite(result[key]):",
    '                raise ValueError("Non-finite story state")',
    "        return result",
    "",
    "label cutbox_start:",
    '    $ cutbox_values = {v["id"]: v["initial"] for v in _cutbox_story["variables"]}',
    "    $ cutbox_steps = 0",
    `    jump ${labels.get(story.startNodeId)}`,
    "",
  ];
  story.nodes.forEach((n, i) => {
    lines.push(
      `label ${labels.get(n.id)}:`,
      "    if cutbox_steps >= 500:",
      '        "Preview step limit reached."',
      "        return",
      `    ${say(n.title)}`,
    );
    if (n.body) lines.push(`    ${say(n.body)}`);
    if (!n.choices.length) {
      lines.push("    return", "");
      return;
    }
    const refs = n.choices.map(
      (_, j) => `_cutbox_story["nodes"][${i}]["choices"][${j}]`,
    );
    lines.push(
      `    if not (${refs.map((ref) => `_cutbox_allowed(cutbox_values, ${ref}["conditions"])`).join(" or ")}):`,
      '        "No choices currently available."',
      "        return",
      "    menu:",
    );
    n.choices.forEach((c, j) =>
      lines.push(
        `        ${say(c.label)} if _cutbox_allowed(cutbox_values, ${refs[j]}["conditions"]):`,
        `            $ cutbox_values = _cutbox_apply(cutbox_values, ${refs[j]}["effects"])`,
        "            $ cutbox_steps += 1",
        `            jump ${labels.get(c.targetId)}`,
      ),
    );
    lines.push("");
  });
  return { filename: `${filename}.rpy`, content: lines.join("\n") };
}
function godotExport(story) {
  return `# CutBox narrative-only exchange for Godot 4. Attach to an empty Control scene.\n# Source media IDs/ranges remain in story data; connect exported media separately.\nextends Control\n\nvar story: Dictionary = JSON.parse_string(${quote(JSON.stringify(story))})\nvar values: Dictionary = {}\nvar current: String = ""\nvar steps: int = 0\nvar panel: VBoxContainer\n\nfunc _ready() -> void:\n\tpanel = VBoxContainer.new()\n\tpanel.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)\n\tadd_child(panel)\n\t_restart()\n\nfunc _restart() -> void:\n\tvalues.clear()\n\tfor variable in story.variables:\n\t\tvalues[variable.id] = variable.initial\n\tsteps = 0\n\tcurrent = story.startNodeId\n\t_render()\n\nfunc _allowed(conditions: Array) -> bool:\n\tfor c in conditions:\n\t\tvar a = values[c.variable]\n\t\tvar b = c.value\n\t\tmatch c.operator:\n\t\t\t"eq":\n\t\t\t\tif a != b: return false\n\t\t\t"ne":\n\t\t\t\tif a == b: return false\n\t\t\t"gt":\n\t\t\t\tif not a > b: return false\n\t\t\t"gte":\n\t\t\t\tif not a >= b: return false\n\t\t\t"lt":\n\t\t\t\tif not a < b: return false\n\t\t\t"lte":\n\t\t\t\tif not a <= b: return false\n\t\t\t_: return false\n\treturn true\n\nfunc _choose(choice: Dictionary) -> void:\n\tif steps >= 500 or not _allowed(choice.conditions): return\n\tvar next = values.duplicate(true)\n\tfor effect in choice.effects:\n\t\tif effect.op == "set": next[effect.variable] = effect.value\n\t\telse: next[effect.variable] += effect.value\n\t\tif next[effect.variable] is float and not is_finite(next[effect.variable]):\n\t\t\tpush_error("Non-finite story state")\n\t\t\treturn\n\tvalues = next\n\tsteps += 1\n\tcurrent = choice.targetId\n\t_render()\n\nfunc _label(message: String) -> void:\n\tvar label = Label.new()\n\tlabel.text = message\n\tlabel.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART\n\tpanel.add_child(label)\n\nfunc _render() -> void:\n\tfor child in panel.get_children():\n\t\tpanel.remove_child(child)\n\t\tchild.queue_free()\n\tvar node: Dictionary = {}\n\tfor item in story.nodes:\n\t\tif item.id == current: node = item\n\t_label(node.title)\n\t_label(node.body)\n\t_label(JSON.stringify(values))\n\tvar available = false\n\tfor choice in node.choices:\n\t\tvar button = Button.new()\n\t\tbutton.text = choice.label\n\t\tbutton.disabled = steps >= 500 or not _allowed(choice.conditions)\n\t\tif not button.disabled: available = true\n\t\tbutton.pressed.connect(_choose.bind(choice))\n\t\tpanel.add_child(button)\n\tif node.kind == "ending": _label("Ending")\n\telif not available: _label("No available choices or preview step limit reached.")\n\tvar restart = Button.new()\n\trestart.text = "Restart"\n\trestart.pressed.connect(_restart)\n\tpanel.add_child(restart)\n`;
}
