import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { MarkdownBody } = await jiti.import("./MarkdownBody.tsx");

function renderMarkdown(markdown) {
  return renderToStaticMarkup(
    React.createElement(MarkdownBody, {
      cwd: "/home/me/project",
      onOpenFile() {},
    }, markdown),
  );
}

test("opens non-file markdown links in a safe new tab", () => {
  const html = renderMarkdown("[docs](https://example.com/docs)");

  assert.match(
    html,
    /<a (?=[^>]*href="https:\/\/example\.com\/docs")(?=[^>]*target="_blank")(?=[^>]*rel="noopener noreferrer")[^>]*>docs<\/a>/,
  );
  assert.doesNotMatch(html, /\snode=/);
});

test("keeps local file markdown links in the app", () => {
  const html = renderMarkdown("[file](components/MarkdownBody.tsx)");

  assert.match(html, /<a href="components\/MarkdownBody\.tsx">file<\/a>/);
  assert.doesNotMatch(html, /target=|rel=|\snode=/);
});

test("renders existing dollar-delimited inline and display math", () => {
  const inlineHtml = renderMarkdown("Euler: $e^{i\\pi}+1=0$");
  const displayHtml = renderMarkdown("$$E=mc^2$$");

  assert.match(inlineHtml, /class="katex"/);
  assert.doesNotMatch(inlineHtml, /class="katex-display"/);
  assert.match(displayHtml, /class="katex-display"/);
});

test("renders single-line bracket-delimited display math", () => {
  const html = renderMarkdown("\\[E=mc^2\\]");

  assert.match(html, /class="katex-display"/);
});

test("renders multiline bracket-delimited display math", () => {
  const html = renderMarkdown("\\[\n\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}\n\\]");

  assert.match(html, /class="katex-display"/);
});

test("does not render bracket-delimited math inside fenced code", () => {
  const html = renderMarkdown("```text\n\\[E=mc^2\\]\n```");

  assert.doesNotMatch(html, /class="katex(?:-display)?"/);
  assert.match(html, /E=mc/);
});

test("leaves an unclosed bracket delimiter untouched", () => {
  const html = renderMarkdown("\\[\nE=mc^2");

  assert.doesNotMatch(html, /class="katex(?:-display)?"/);
  assert.match(html, /\[\nE=mc\^2/);
});
