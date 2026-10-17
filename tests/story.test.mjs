import test from "node:test";
import assert from "node:assert/strict";
import {
  validateStory,
  diagnoseStory,
  beginStory,
  chooseStory,
  storyChoices,
  exportStory,
} from "../desktop/story.mjs";
const example = () => ({
  id: "story",
  name: "调查",
  description: "",
  variables: [
    { id: "known", name: "已知线索", type: "boolean", initial: false },
    { id: "trust", name: "信任", type: "number", initial: 0 },
  ],
  startNodeId: "station",
  nodes: [
    {
      id: "station",
      title: "车站",
      body: "阅读信件",
      kind: "scene",
      mediaId: "media",
      start: 1,
      end: 3,
      eventIds: ["event"],
      choices: [
        {
          id: "read",
          label: "阅读",
          targetId: "station",
          conditions: [{ variable: "known", operator: "eq", value: false }],
          effects: [
            { variable: "known", op: "set", value: true },
            { variable: "trust", op: "add", value: 2 },
          ],
        },
        {
          id: "solve",
          label: "还原事件",
          targetId: "end",
          conditions: [
            { variable: "known", operator: "eq", value: true },
            { variable: "trust", operator: "gte", value: 2 },
          ],
          effects: [],
        },
      ],
    },
    { id: "end", title: "结局", body: "真相", kind: "ending", choices: [] },
  ],
});
const snapshot = {
  media: [{ id: "media", duration: 5, kind: "video" }],
  events: [{ id: "event" }],
};
test("story normalization validates source anchors and keeps metadata independent", () => {
  const input = {
    ...example(),
    createdAt: "2026-10-17",
    updatedAt: "2026-10-17",
  };
  const value = validateStory(input, snapshot);
  value.nodes[0].choices[0].effects[0].value = false;
  assert.equal(input.nodes[0].choices[0].effects[0].value, true);
  assert.equal(value.createdAt, input.createdAt);
  assert.equal(value.nodes[0].epistemic, "invented");
  input.nodes[0].epistemic = "observed";
  assert.equal(validateStory(input, snapshot).nodes[0].epistemic, "observed");
  assert.throws(
    () => validateStory(input, { ...snapshot, events: [] }),
    /事件/,
  );
  assert.throws(() => validateStory(input, { ...snapshot, media: [] }), /素材/);
  input.nodes[0].end = 6;
  assert.throws(() => validateStory(input, snapshot), /区间/);
});
test("typed runtime locks and unlocks choices with atomic state and immutable source", () => {
  const story = example();
  const start = beginStory(story);
  assert.deepEqual(
    storyChoices(story, start).map((c) => c.available),
    [true, false],
  );
  assert.throws(() => chooseStory(story, start, "solve"), /条件/);
  const found = chooseStory(story, start, "read");
  assert.deepEqual(found.values, { known: true, trust: 2 });
  assert.equal(start.values.known, false);
  assert.deepEqual(
    storyChoices(story, found).map((c) => c.available),
    [false, true],
  );
  const end = chooseStory(story, found, "solve");
  assert.equal(end.nodeId, "end");
  assert.equal(end.steps, 2);
  assert.equal(end.history[1].from, "station");
  assert.deepEqual(storyChoices(story, end), []);
  assert.equal(story.variables[0].initial, false);
});
test("strict graph rejects dangling IDs, dangerous keys, duplicate IDs and incompatible types", () => {
  for (const modify of [
    (s) => {
      s.nodes[0].choices[0].targetId = "absent";
    },
    (s) => {
      s.variables[0].id = "__proto__";
    },
    (s) => {
      s.variables[0].initial = "false";
    },
    (s) => {
      s.nodes[0].choices[0].conditions[0].operator = "gt";
    },
    (s) => {
      s.nodes[0].choices[0].effects[0].op = "add";
    },
    (s) => {
      s.nodes[0].choices[0].effects[0].variable = "absent";
    },
    (s) => {
      s.nodes[0].choices[1].id = "read";
    },
    (s) => {
      s.nodes.push({ ...s.nodes[1] });
    },
    (s) => {
      s.nodes[1].choices = s.nodes[0].choices;
    },
    (s) => {
      s.startNodeId = "none";
    },
  ]) {
    const story = example();
    modify(story);
    assert.throws(() => validateStory(story));
  }
});
test("numeric overflow cannot partially apply effects or mutate session", () => {
  const story = example();
  story.variables[1].initial = Number.MAX_VALUE;
  story.nodes[0].choices[0].effects[1].value = Number.MAX_VALUE;
  const start = beginStory(story);
  assert.throws(() => chooseStory(story, start, "read"), /状态变化结果/);
  assert.equal(start.values.known, false);
  assert.equal(start.values.trust, Number.MAX_VALUE);
  assert.equal(start.steps, 0);
});
test("graph diagnostics identify cycles, unreachable nodes, dangling targets and non-ending dead ends", () => {
  const story = example();
  story.nodes.push({ id: "orphan", title: "孤点", kind: "clue", choices: [] });
  const codes = diagnoseStory(story).map((d) => d.code);
  assert.ok(codes.includes("cycle"));
  assert.ok(codes.includes("unreachable"));
  assert.ok(codes.includes("dead_end"));
  story.nodes[0].choices[1].targetId = "gone";
  assert.ok(diagnoseStory(story).some((d) => d.code === "dangling_target"));
});
test("session shape and preview limits are enforced", () => {
  const story = example();
  let session = beginStory(story);
  assert.throws(
    () =>
      chooseStory(
        story,
        { ...session, values: { known: "false", trust: 0 } },
        "read",
      ),
    /预演变量/,
  );
  assert.throws(
    () => chooseStory(story, { ...session, nodeId: "absent" }, "read"),
    /节点/,
  );
  assert.throws(
    () => chooseStory(story, { ...session, steps: 2 }, "read"),
    /历史/,
  );
  story.nodes[0].choices[0].conditions = [];
  session = beginStory(story);
  for (let i = 0; i < 500; i++) session = chooseStory(story, session, "read");
  assert.throws(() => chooseStory(story, session, "read"), /500/);
  assert.ok(storyChoices(story, session).every((c) => !c.available));
});
test("exports preserve text as data and emit native engine narrative adapters", () => {
  const story = example();
  story.nodes[0].body = '"\n[evil()] {i} $ dangerous = True';
  const json = exportStory({ story, format: "json", snapshot });
  const imported = JSON.parse(json.content);
  assert.deepEqual(
    validateStory(imported.story, snapshot),
    validateStory(story, snapshot),
  );
  assert.equal(imported.media[0].id, "media");
  assert.equal(imported.media[0].path, undefined);
  const renpy = exportStory({ story, format: "renpy" });
  assert.equal(renpy.filename, "cutbox-story.rpy");
  assert.match(renpy.content, /\[\[evil/);
  assert.match(renpy.content, /\{\{i\}/);
  assert.ok(
    !renpy.content.split("\n").some((line) => line.startsWith("$ dangerous")),
  );
  const godot = exportStory({ story, format: "godot" });
  assert.match(godot.content, /extends Control/);
  assert.match(godot.content, /JSON.parse_string/);
  assert.ok(!/\beval\(/.test(renpy.content + godot.content));
  assert.throws(() => exportStory({ story, format: "unknown" }), /格式/);
});

// Optional native engine checks: core story tests never depend on either engine.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
test("generated RenPy Python helpers parse and follow the same state transitions", (t) => {
  const probe = spawnSync("python3", ["--version"], { encoding: "utf8" });
  if (probe.error?.code === "ENOENT") return t.skip("python3 not installed");
  assert.equal(probe.status, 0, probe.error?.message || probe.stderr);
  const source = exportStory({ story: example(), format: "renpy" }).content;
  const python = `import ast, textwrap, sys\nfrom pathlib import Path\nsource = Path(sys.argv[1]).read_text().split('init python:\\n', 1)[1].split('\\nlabel cutbox_start:', 1)[0]\nnamespace = {}\nexec(compile(ast.parse(textwrap.dedent(source)), 'generated-renpy', 'exec'), namespace)\nstory = namespace['_cutbox_story']\nvalues = {v['id']: v['initial'] for v in story['variables']}\nread, solve = story['nodes'][0]['choices']\nassert namespace['_cutbox_allowed'](values, read['conditions'])\nassert not namespace['_cutbox_allowed'](values, solve['conditions'])\nupdated = namespace['_cutbox_apply'](values, read['effects'])\nassert updated == {'known': True, 'trust': 2}\nassert values == {'known': False, 'trust': 0}\nassert namespace['_cutbox_allowed'](updated, solve['conditions'])\n`;
  const directory = mkdtempSync(join(tmpdir(), "cutbox-story-renpy-"));
  try {
    const path = join(directory, "story.rpy");
    writeFileSync(path, source);
    const result = spawnSync("python3", ["-c", python, path], {
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(result.status, 0, result.error?.message || result.stderr);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test("generated Godot 4 adapter parses, locks choices, transitions and resets in actual engine", (t) => {
  const command = process.env.CUTBOX_GODOT || "godot";
  const probe = spawnSync(command, ["--version"], {
    encoding: "utf8",
    timeout: 10000,
  });
  if (probe.error?.code === "ENOENT") return t.skip("Godot not installed");
  assert.equal(probe.status, 0, probe.error?.message || probe.stderr);
  const directory = mkdtempSync(join(tmpdir(), "cutbox-story-godot-"));
  try {
    writeFileSync(
      join(directory, "project.godot"),
      'config_version=5\n[application]\nconfig/name="CutBox story test"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n',
    );
    writeFileSync(
      join(directory, "cutbox-story.gd"),
      exportStory({ story: example(), format: "godot" }).content,
    );
    writeFileSync(
      join(directory, "test_runner.gd"),
      `extends SceneTree\nvar failed = false\nfunc _initialize() -> void:\n\tcall_deferred("_run")\nfunc check(condition: bool, label: String) -> void:\n\tif not condition:\n\t\tprinterr(label)\n\t\tfailed = true\nfunc _run() -> void:\n\tvar scene = load("res://cutbox-story.gd").new()\n\troot.add_child(scene)\n\tcheck(scene.current == "station", "start")\n\tcheck(scene.values.known == false, "false initial")\n\tscene._choose(scene.story.nodes[0].choices[1])\n\tcheck(scene.current == "station" and scene.steps == 0, "locked choice")\n\tscene._choose(scene.story.nodes[0].choices[0])\n\tcheck(scene.values.known == true and scene.values.trust == 2, "effects")\n\tscene._choose(scene.story.nodes[0].choices[1])\n\tcheck(scene.current == "end" and scene.steps == 2, "ending")\n\tscene._restart()\n\tcheck(scene.current == "station" and scene.values.known == false, "restart")\n\tif not failed: print("CUTBOX_GODOT_RUNTIME_OK")\n\tquit(1 if failed else 0)\n`,
    );
    const result = spawnSync(
      command,
      [
        "--headless",
        "--path",
        directory,
        "--script",
        join(directory, "test_runner.gd"),
      ],
      {
        encoding: "utf8",
        timeout: 15000,
        env: {
          ...process.env,
          XDG_DATA_HOME: join(directory, "data"),
          XDG_CONFIG_HOME: join(directory, "config"),
          XDG_CACHE_HOME: join(directory, "cache"),
        },
      },
    );
    assert.equal(result.status, 0, result.error?.message || result.stderr);
    assert.match(result.stdout, /CUTBOX_GODOT_RUNTIME_OK/);
    assert.doesNotMatch(result.stderr, /SCRIPT ERROR|Parse Error/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
