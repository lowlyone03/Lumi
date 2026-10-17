import subprocess
import sys
import os

def main():
    print("Running pytest via subprocess...")
    env = dict(os.environ)
    env["PYTHONPATH"] = "."
    env["PYTHONIOENCODING"] = "utf-8"
    res = subprocess.run(
        [sys.executable, "-m", "pytest", "tests/test_b4_courses_quizzes.py", "-v", "--tb=short"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=env
    )
    with open("real_pytest_output.txt", "w", encoding="utf-8") as f:
        f.write("=== STDOUT ===\n")
        f.write(res.stdout)
        f.write("\n=== STDERR ===\n")
        f.write(res.stderr)
        f.write(f"\nRETURN CODE: {res.returncode}\n")
    print(f"Pytest finished with code: {res.returncode}")

if __name__ == "__main__":
    main()
