// Saneado de los valores de los JSON antes de llegar al HTML (revisión P1).
import assert from "node:assert/strict";
import { test } from "node:test";
import { enlace, esc, num, urlSegura } from "../site/js/seguro.js";

test("esc neutraliza etiquetas y comillas", () => {
  assert.equal(esc('<img src=x onerror="alert(1)">'), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  assert.equal(esc(null), "");
});

test("num solo admite números finitos", () => {
  assert.equal(num(21), 21);
  assert.equal(num(-3.5), -3.5);
  for (const v of ["<img src=x onerror=alert(1)>", "21", null, undefined, Number.NaN, Infinity, {}, []]) {
    assert.equal(num(v), null, String(v));
  }
});

test("urlSegura solo deja pasar http: y https:", () => {
  assert.equal(urlSegura("https://commons.wikimedia.org/a?b=1"), "https://commons.wikimedia.org/a?b=1");
  assert.equal(urlSegura("http://example.org/"), "http://example.org/");
  for (const v of [
    "javascript:alert(1)",
    " JaVaScRiPt:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,x",
    "vbscript:x",
    "/relativa",
    "",
    null,
    3,
  ]) {
    assert.equal(urlSegura(v), null, String(v));
  }
});

test("enlace omite el <a> si la URL no es válida y escapa el texto", () => {
  assert.equal(enlace("javascript:alert(1)", "<b>x</b>"), "&lt;b&gt;x&lt;/b&gt;");
  assert.equal(enlace('https://a.org/?q="', "t"), '<a href="https://a.org/?q=%22">t</a>');
});
