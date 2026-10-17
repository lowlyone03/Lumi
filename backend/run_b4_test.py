import sys
import os
import traceback
import pytest

# Ensure utf-8 encoding
os.environ["PYTHONIOENCODING"] = "utf-8"

def main():
    log_file = "test_run_result.log"
    with open(log_file, "w", encoding="utf-8") as f:
        # Redirect stdout and stderr
        old_stdout = sys.stdout
        old_stderr = sys.stderr
        sys.stdout = f
        sys.stderr = f
        try:
            print("=== STARTING PYTEST ===")
            ret = pytest.main([
                "tests/test_b4_courses_quizzes.py",
                "-v",
                "--tb=short"
            ])
            print("=== PYTEST FINISHED ===")
            print(f"EXIT CODE: {ret}")
        except Exception as e:
            traceback.print_exc()
        finally:
            sys.stdout = old_stdout
            sys.stderr = old_stderr

    print(f"Done. Check {log_file}")

if __name__ == "__main__":
    main()
