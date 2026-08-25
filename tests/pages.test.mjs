import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";


const readPage = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("keeps the home page focused on navigation instead of work forms", async () => {
  const html = await readPage("index.html");
  for (const route of ["evidence.html", "proposals.html", "governance.html", "decisions.html"]) {
    assert.match(html, new RegExp(`href="${route}"`));
  }
  assert.doesNotMatch(html, /id="truth-form"/);
  assert.doesNotMatch(html, /id="proposal-form"/);
  assert.doesNotMatch(html, /id="proposal-list"/);
});

test("gives each product job its own uncluttered page", async () => {
  const evidence = await readPage("evidence.html");
  const proposals = await readPage("proposals.html");
  const governance = await readPage("governance.html");
  const decisions = await readPage("decisions.html");

  assert.match(evidence, /id="truth-form"/);
  assert.match(evidence, /id="truth-feed"/);
  assert.doesNotMatch(evidence, /id="proposal-form"|id="proposal-list"|id="registry-list"/);

  assert.match(proposals, /id="proposal-form"/);
  assert.match(proposals, /id="proposal-evidence-options"/);
  assert.doesNotMatch(proposals, /id="truth-form"|id="proposal-list"|id="registry-list"/);

  assert.match(governance, /id="charter-list"/);
  assert.match(governance, /id="proposal-list"/);
  assert.doesNotMatch(governance, /id="truth-form"|id="proposal-form"|id="registry-list"/);

  assert.match(decisions, /id="registry-search"/);
  assert.match(decisions, /id="registry-list"/);
  assert.doesNotMatch(decisions, /id="truth-form"|id="proposal-form"|id="proposal-list"/);
});

test("keeps wallet and StudioNet status controls on every interactive page", async () => {
  for (const page of ["index.html", "evidence.html", "proposals.html", "governance.html", "decisions.html"]) {
    const html = await readPage(page);
    assert.match(html, /id="network-status"/);
    assert.match(html, /id="connect-wallet"/);
    assert.match(html, /id="wallet-chip"/);
    assert.match(html, /id="toast-root"/);
  }
});
