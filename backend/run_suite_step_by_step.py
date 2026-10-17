import subprocess
import sys
import os
import time

TESTS = [
    "test_01_create_course_and_link_source",
    "test_02_generate_curriculum_draft_and_apply",
    "test_03_track_source_and_lesson_progress",
    "test_04_polymorphic_notes_crud_and_constraints",
    "test_05_quiz_ai_generation_and_publishing",
    "test_06_quiz_attempt_answering_and_atomic_submit",
    "test_07_rls_cross_account_isolation_b4",
]

def main():
    log_file = "b4_test_results.txt"
    env = dict(os.environ)
    env["PYTHONPATH"] = "."
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUNBUFFERED"] = "1"

    with open(log_file, "w", encoding="utf-8") as out_f:
        header = f"=== B4 TEST SUITE EXECUTION START ({time.strftime('%Y-%m-%d %H:%M:%S')}) ===\n"
        print(header, flush=True)
        out_f.write(header)
        out_f.flush()

        results = []
        for test_name in TESTS:
            target = f"tests/test_b4_courses_quizzes.py::{test_name}"
            print(f"Running {test_name}...", end="", flush=True)
            start_t = time.time()
            
            p = subprocess.run(
                [sys.executable, "-m", "pytest", target, "-v", "--tb=short"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                env=env
            )
            elapsed = time.time() - start_t
            status = "PASSED" if p.returncode == 0 else "FAILED"
            msg = f"{status} in {elapsed:.2f}s"
            print(f" {msg}", flush=True)
            out_f.write(f"[{status}] {test_name} ({elapsed:.2f}s)\n")
            if p.returncode != 0:
                out_f.write(f"--- FAILURE DETAILS ---\n{p.stdout}\n{p.stderr}\n")
            out_f.flush()
            results.append((test_name, status, elapsed))

        summary = "\n=== B4 TEST SUMMARY ===\n"
        passed_count = sum(1 for _, s, _ in results if s == "PASSED")
        total_count = len(results)
        summary += f"Total: {total_count}, Passed: {passed_count}, Failed: {total_count - passed_count}\n"
        for name, st, el in results:
            summary += f"- {name}: {st} ({el:.2f}s)\n"
        print(summary, flush=True)
        out_f.write(summary)
        out_f.flush()

    print(f"Done! Check {log_file}", flush=True)
    if passed_count < total_count:
        sys.exit(1)

if __name__ == "__main__":
    main()
