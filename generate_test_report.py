#!/usr/bin/env python3
"""
generate_test_report.py
Ejecuta backend (pytest) + frontend (jest), parsea resultados y genera
test_report.html — listo para abrir en el navegador e imprimir como PDF.

Uso:
    python generate_test_report.py              # genera test_report.html
    python generate_test_report.py --md         # genera también test_report.md
"""
import argparse
import html as html_lib
import json
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

# ── Paths ─────────────────────────────────────────────────────────────────────

ROOT = Path(__file__).resolve().parent
WEB_DIR = ROOT / "web"
REPORTS_DIR = ROOT / "docs" / "reports"
REPORT_HTML = REPORTS_DIR / "test_report.html"
REPORT_MD = REPORTS_DIR / "test_report.md"
JEST_JSON_TMP = WEB_DIR / ".jest_results.json"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _venv_python() -> str:
    for candidate in [
        ROOT / ".venv" / "Scripts" / "python.exe",
        ROOT / ".venv" / "bin" / "python",
    ]:
        if candidate.exists():
            return str(candidate)
    return sys.executable


def _npm_cmd() -> list[str]:
    # On Windows both 'npm' and 'npm.cmd' exist; shutil.which handles it.
    npm = shutil.which("npm.cmd") or shutil.which("npm") or "npm"
    return [npm]


# ── Data model ────────────────────────────────────────────────────────────────

@dataclass
class TestResult:
    name: str
    suite: str        # test file / describe block
    status: str       # PASSED | FAILED | ERROR | SKIPPED
    message: str = "" # failure message (if any)
    expected: str = ""  # expected value extracted from assertion (if available)
    received: str = ""  # received value extracted from assertion (if available)


@dataclass
class SuiteReport:
    name: str         # "Backend (Python / pytest)"
    passed: int = 0
    failed: int = 0
    skipped: int = 0
    duration: float = 0.0
    tests: list[TestResult] = field(default_factory=list)
    raw_output: str = ""
    success: bool = True


# ── Run tests ─────────────────────────────────────────────────────────────────

def run_pytest() -> SuiteReport:
    report = SuiteReport(name="Backend (Python / pytest)")
    python = _venv_python()

    print("  > Ejecutando pytest...")
    proc = subprocess.run(
        [python, "-m", "pytest", "tests/", "-v", "--tb=short", "--no-header"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    output = proc.stdout + proc.stderr
    report.raw_output = output
    report.success = proc.returncode == 0

    # Parse individual test lines
    # e.g.  tests/test_vad.py::test_frame_samples_matches_config PASSED   [ 1%]
    test_pattern = re.compile(
        r"^(tests/[\w/]+\.py)::(\S+)\s+(PASSED|FAILED|ERROR|SKIPPED)",
        re.MULTILINE,
    )
    failure_blocks: dict[str, str] = {}

    # Collect failure details from FAILURES section
    failure_section = re.search(r"=+ FAILURES =+(.*?)(?:=+ \w|$)", output, re.DOTALL)
    if failure_section:
        for block in re.split(r"_{5,}", failure_section.group(1)):
            title_match = re.search(r"_+ (\S+) _+", block)
            if title_match:
                failure_blocks[title_match.group(1)] = block.strip()

    for m in test_pattern.finditer(output):
        suite_file = m.group(1)
        test_name = m.group(2)
        status = m.group(3)
        msg = failure_blocks.get(test_name, "")
        expected = received = ""
        if msg:
            # pytest short-form: "assert 'x' == 'y'" or "AssertionError: assert ..."
            ae = re.search(r"AssertionError:\s+assert\s+(.+?)(?:\n|$)", msg)
            if ae:
                parts = ae.group(1).split(" == ", 1)
                if len(parts) == 2:
                    received, expected = parts[0].strip(), parts[1].strip()
        report.tests.append(TestResult(
            name=test_name, suite=suite_file, status=status,
            message=msg, expected=expected, received=received,
        ))

    # Parse summary line
    # e.g.  "62 passed, 1 failed in 16.52s"
    summary = re.search(
        r"(\d+) passed(?:,\s*(\d+) failed)?(?:,\s*(\d+) (?:warning|skipped))?.*?in ([\d.]+)s",
        output,
    )
    if summary:
        report.passed = int(summary.group(1))
        report.failed = int(summary.group(2) or 0)
        report.duration = float(summary.group(4) or 0)
    else:
        report.passed = sum(1 for t in report.tests if t.status == "PASSED")
        report.failed = sum(1 for t in report.tests if t.status in ("FAILED", "ERROR"))

    status_icon = "OK" if report.success else "FAIL"
    print(f"    [{status_icon}] {report.passed} passed, {report.failed} failed  ({report.duration:.1f}s)")
    return report


def run_jest() -> SuiteReport:
    report = SuiteReport(name="Frontend (TypeScript / Jest)")

    print("  > Ejecutando jest...")
    npm = _npm_cmd()
    proc = subprocess.run(
        npm + ["test", "--", "--no-coverage", "--json", f"--outputFile={JEST_JSON_TMP}"],
        cwd=WEB_DIR,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    report.raw_output = proc.stdout + proc.stderr
    report.success = proc.returncode == 0

    if not JEST_JSON_TMP.exists():
        print("    ✗ No se pudo leer el JSON de jest")
        return report

    data: dict = json.loads(JEST_JSON_TMP.read_text(encoding="utf-8"))
    JEST_JSON_TMP.unlink(missing_ok=True)

    report.passed = data.get("numPassedTests", 0)
    report.failed = data.get("numFailedTests", 0)
    report.skipped = data.get("numPendingTests", 0)
    report.duration = data.get("testResults", [{}])[0].get("perfStats", {}).get("runtime", 0) / 1000
    # Sum all suite runtimes
    report.duration = sum(
        s.get("perfStats", {}).get("runtime", 0) for s in data.get("testResults", [])
    ) / 1000

    for suite in data.get("testResults", []):
        suite_path = suite.get("testFilePath", "")
        # Shorten to relative path
        try:
            suite_name = Path(suite_path).relative_to(WEB_DIR).as_posix()
        except ValueError:
            suite_name = suite_path

        for assertion in suite.get("assertionResults", []):
            ancestors = assertion.get("ancestorTitles", [])
            title = assertion.get("title", "")
            full_name = " › ".join(ancestors + [title]) if ancestors else title
            status_raw = assertion.get("status", "")
            status = {
                "passed": "PASSED",
                "failed": "FAILED",
                "pending": "SKIPPED",
            }.get(status_raw, status_raw.upper())
            msg = "\n".join(assertion.get("failureMessages", []))
            expected = received = ""
            if msg:
                exp_m = re.search(r"Expected:\s+(.+)", msg)
                rcv_m = re.search(r"Received:\s+(.+)", msg)
                if exp_m:
                    expected = exp_m.group(1).strip()
                if rcv_m:
                    received = rcv_m.group(1).strip()
            report.tests.append(TestResult(
                name=full_name, suite=suite_name, status=status,
                message=msg, expected=expected, received=received,
            ))

    status_icon = "OK" if report.success else "FAIL"
    print(f"    [{status_icon}] {report.passed} passed, {report.failed} failed  ({report.duration:.1f}s)")
    return report


# ── HTML generation ───────────────────────────────────────────────────────────

_CSS = """
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, 'Segoe UI', Arial, sans-serif; font-size: 14px;
       color: #1a1a2e; background: #f4f7fb; padding: 32px 24px; }
h1 { font-size: 1.8rem; margin-bottom: 4px; }
.subtitle { color: #555; margin-bottom: 28px; font-size: 0.95rem; }

/* Summary cards */
.cards { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 36px; }
.card { flex: 1; min-width: 220px; border-radius: 10px; padding: 20px 24px;
        background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
.card h3 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: .08em;
           color: #888; margin-bottom: 8px; }
.card .total { font-size: 2rem; font-weight: 700; line-height: 1; }
.card .detail { font-size: 0.88rem; margin-top: 6px; color: #555; }
.card.all-pass .total { color: #16a34a; }
.card.has-fail .total { color: #dc2626; }

/* Sections */
.section { background: #fff; border-radius: 10px; box-shadow: 0 2px 8px rgba(0,0,0,.08);
           margin-bottom: 28px; overflow: hidden; }
.section-header { padding: 16px 20px; background: #1a1a2e; color: #fff;
                  display: flex; align-items: center; gap: 10px; }
.section-header h2 { font-size: 1rem; }
.badge { padding: 3px 10px; border-radius: 20px; font-size: .75rem; font-weight: 600; }
.badge-pass { background: #dcfce7; color: #16a34a; }
.badge-fail { background: #fee2e2; color: #dc2626; }

/* Table */
table { width: 100%; border-collapse: collapse; font-size: .88rem; }
th { background: #f1f5f9; color: #334155; font-weight: 600; text-align: left;
     padding: 10px 14px; border-bottom: 1px solid #e2e8f0; }
td { padding: 8px 14px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
tr:last-child td { border-bottom: none; }
tr:hover td { background: #fafbff; }
.suite { color: #64748b; font-size: .8rem; }
.st-pass { color: #16a34a; font-weight: 600; }
.st-fail { color: #dc2626; font-weight: 600; }
.st-skip { color: #d97706; font-weight: 600; }

/* Raw output (suite-level) */
details.suite-raw { padding: 0 20px 16px; }
details.suite-raw > summary { cursor: pointer; color: #64748b; font-size: .85rem;
                  padding: 12px 0 8px; user-select: none; }
details.suite-raw > summary:hover { color: #334155; }
pre { background: #0f172a; color: #e2e8f0; border-radius: 6px; padding: 16px;
      overflow-x: auto; font-size: .78rem; line-height: 1.5;
      max-height: 400px; overflow-y: auto; }

/* Per-test detail collapsible */
details.test-detail { margin-top: 4px; }
details.test-detail > summary { cursor: pointer; font-size: .75rem; color: #94a3b8;
                                user-select: none; list-style: none; display: inline-flex;
                                align-items: center; gap: 4px; }
details.test-detail > summary::before { content: "▶"; font-size: .6rem; }
details.test-detail[open] > summary::before { content: "▼"; }
details.test-detail > summary:hover { color: #475569; }
.test-detail-body { margin-top: 6px; font-size: .78rem; }
.exp-recv-grid { display: grid; grid-template-columns: 80px 1fr; gap: 4px 8px;
                 align-items: start; background: #f8fafc; border-radius: 4px;
                 padding: 8px 10px; border: 1px solid #e2e8f0; }
.exp-label { font-weight: 600; color: #475569; font-size: .75rem; padding-top: 2px; }
.exp-val { font-family: 'Courier New', monospace; background: #dcfce7; color: #166534;
           border-radius: 3px; padding: 2px 6px; word-break: break-all; }
.rcv-val { font-family: 'Courier New', monospace; background: #fee2e2; color: #991b1b;
           border-radius: 3px; padding: 2px 6px; word-break: break-all; }
.pass-detail { color: #16a34a; font-size: .75rem; font-style: italic; }
.failure-msg { font-family: 'Courier New', monospace; font-size: .75rem;
               white-space: pre-wrap; color: #7f1d1d; background: #fef2f2;
               border-radius: 4px; padding: 8px; margin-top: 6px;
               max-height: 200px; overflow-y: auto; }

/* Print */
@media print {
  body { background: #fff; padding: 16px; }
  .section { box-shadow: none; border: 1px solid #e2e8f0; }
  details[open] pre { max-height: none; }
}
"""


def _status_class(status: str) -> str:
    return {"PASSED": "st-pass", "FAILED": "st-fail", "ERROR": "st-fail", "SKIPPED": "st-skip"}.get(status, "")


def _status_icon(status: str) -> str:
    return {"PASSED": "✓", "FAILED": "✗", "ERROR": "✗", "SKIPPED": "⊘"}.get(status, status)


def _suite_badge(report: SuiteReport) -> str:
    cls = "badge-pass" if report.success else "badge-fail"
    icon = "✓" if report.success else "✗"
    return f'<span class="badge {cls}">{icon} {report.passed}/{report.passed + report.failed}</span>'


def _test_detail_html(t: TestResult) -> str:
    """Build the collapsible body for a failed/errored test."""
    body_parts: list[str] = []

    if t.expected or t.received:
        exp_escaped = html_lib.escape(t.expected[:300]) if t.expected else "<em>—</em>"
        rcv_escaped = html_lib.escape(t.received[:300]) if t.received else "<em>—</em>"
        body_parts.append(
            '<div class="test-detail-body">'
            '<div class="exp-recv-grid">'
            f'<span class="exp-label">Esperado</span><span class="exp-val">{exp_escaped}</span>'
            f'<span class="exp-label">Obtenido</span><span class="rcv-val">{rcv_escaped}</span>'
            "</div></div>"
        )

    if t.message:
        escaped_msg = html_lib.escape(t.message[:1000])
        body_parts.append(f'<div class="failure-msg">{escaped_msg}</div>')

    return "\n".join(body_parts) if body_parts else '<div class="test-detail-body"><span class="pass-detail">Sin detalles adicionales</span></div>'


def _test_rows(tests: list[TestResult]) -> str:
    rows = []
    for t in tests:
        sc = _status_class(t.status)
        icon = _status_icon(t.status)
        name_html = html_lib.escape(t.name)
        if t.status in ("FAILED", "ERROR"):
            detail_content = _test_detail_html(t)
            name_html += (
                f'<details class="test-detail">'
                f"<summary>ver error</summary>"
                f"{detail_content}"
                f"</details>"
            )
        rows.append(
            f"<tr>"
            f"<td><span class='suite'>{html_lib.escape(t.suite)}</span></td>"
            f"<td>{name_html}</td>"
            f"<td class='{sc}'>{icon} {t.status}</td>"
            f"</tr>"
        )
    return "\n".join(rows)


def _summary_card(report: SuiteReport) -> str:
    total = report.passed + report.failed
    cls = "all-pass" if report.success else "has-fail"
    label = "passed" if report.success else "failed"
    detail = f"{report.passed}/{total} tests passed &bull; {report.duration:.1f}s"
    return (
        f'<div class="card {cls}">'
        f"<h3>{html_lib.escape(report.name)}</h3>"
        f'<div class="total">{report.passed if report.success else report.failed} {label}</div>'
        f'<div class="detail">{detail}</div>'
        f"</div>"
    )


def _section_html(report: SuiteReport) -> str:
    badge = _suite_badge(report)
    rows = _test_rows(report.tests)
    raw = html_lib.escape(report.raw_output)
    return f"""
<div class="section">
  <div class="section-header">
    <h2>{html_lib.escape(report.name)}</h2>
    {badge}
    <span style="margin-left:auto;font-size:.82rem;color:#94a3b8">{report.duration:.1f}s</span>
  </div>
  <table>
    <thead><tr><th style="width:28%">Archivo</th><th>Test</th><th style="width:100px">Resultado</th></tr></thead>
    <tbody>{rows}</tbody>
  </table>
  <details class="suite-raw">
    <summary>▸ Salida completa del runner</summary>
    <pre>{raw}</pre>
  </details>
</div>"""


def generate_html(backend: SuiteReport, frontend: SuiteReport, generated_at: str) -> str:
    total_pass = backend.passed + frontend.passed
    total_fail = backend.failed + frontend.failed
    overall_ok = backend.success and frontend.success
    overall_label = "✓ Todos los tests pasan" if overall_ok else f"✗ {total_fail} test(s) fallido(s)"
    overall_cls = "all-pass" if overall_ok else "has-fail"

    overall_card = (
        f'<div class="card {overall_cls}">'
        f"<h3>Total</h3>"
        f'<div class="total">{total_pass + total_fail}</div>'
        f'<div class="detail">{overall_label}</div>'
        f"</div>"
    )

    return f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TranslateApp — Test Report</title>
  <style>{_CSS}</style>
</head>
<body>
  <h1>TranslateApp — Reporte de Tests</h1>
  <p class="subtitle">Generado: {html_lib.escape(generated_at)}</p>

  <div class="cards">
    {overall_card}
    {_summary_card(backend)}
    {_summary_card(frontend)}
  </div>

  {_section_html(backend)}
  {_section_html(frontend)}
</body>
</html>"""


# ── Markdown generation ───────────────────────────────────────────────────────

def generate_md(backend: SuiteReport, frontend: SuiteReport, generated_at: str) -> str:
    def suite_table(report: SuiteReport) -> str:
        lines = [
            "| Archivo | Test | Resultado |",
            "|---------|------|-----------|",
        ]
        for t in report.tests:
            icon = _status_icon(t.status)
            lines.append(f"| `{t.suite}` | {t.name} | {icon} {t.status} |")
        return "\n".join(lines)

    return f"""# TranslateApp — Reporte de Tests

**Generado:** {generated_at}

## Resumen

| Suite | Pasados | Fallidos | Duración |
|-------|---------|----------|----------|
| {backend.name} | {backend.passed} | {backend.failed} | {backend.duration:.1f}s |
| {frontend.name} | {frontend.passed} | {frontend.failed} | {frontend.duration:.1f}s |
| **Total** | **{backend.passed + frontend.passed}** | **{backend.failed + frontend.failed}** | — |

---

## {backend.name}

{suite_table(backend)}

---

## {frontend.name}

{suite_table(frontend)}
"""


# ── Main ──────────────────────────────────────────────────────────────────────

def _print(msg: str) -> None:
    """Print with safe ASCII fallback for narrow console encodings."""
    try:
        print(msg)
    except UnicodeEncodeError:
        print(msg.encode("ascii", errors="replace").decode("ascii"))


def main() -> None:
    # Force UTF-8 output on Windows consoles that default to cp1252
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

    parser = argparse.ArgumentParser(description="Genera el reporte de tests de TranslateApp")
    parser.add_argument("--md", action="store_true", help="Genera tambien test_report.md")
    parser.add_argument("--output", default=str(REPORT_HTML), help="Ruta del HTML de salida")
    args = parser.parse_args()

    generated_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    _print(f"\n{'='*52}")
    _print("  TranslateApp - Test Report Generator")
    _print(f"  {generated_at}")
    _print(f"{'='*52}\n")

    backend = run_pytest()
    frontend = run_jest()

    html_out = Path(args.output)
    html_out.write_text(generate_html(backend, frontend, generated_at), encoding="utf-8")
    _print(f"\n  [OK] HTML generado -> {html_out}")

    if args.md:
        REPORT_MD.write_text(generate_md(backend, frontend, generated_at), encoding="utf-8")
        _print(f"  [OK] Markdown generado -> {REPORT_MD}")

    total = backend.passed + frontend.passed
    fail = backend.failed + frontend.failed
    _print(f"\n  Resultado: {total} passed, {fail} failed\n")

    sys.exit(0 if (backend.success and frontend.success) else 1)


if __name__ == "__main__":
    main()
