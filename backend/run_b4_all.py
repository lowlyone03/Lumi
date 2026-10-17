import sys
import os
import pytest

os.environ["PYTHONPATH"] = "."
os.environ["PYTHONIOENCODING"] = "utf-8"
os.environ["PYTHONUNBUFFERED"] = "1"

if __name__ == "__main__":
    print("=== RUNNING FULL B4 TEST SUITE ===", flush=True)
    exit_code = pytest.main([
        "tests/test_b4_courses_quizzes.py",
        "-v",
        "-s",
        "--tb=short"
    ])
    print(f"\n=== FINISHED ALL B4 TESTS WITH EXIT CODE: {exit_code} ===", flush=True)
    sys.exit(exit_code)
