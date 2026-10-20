with open('kltn/frontend/source/core.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Add openCourseLesson
old_course_part = "map((t,i)=>'<button class=\"lessonrow\" onclick=\"go(\\'reader\\')\">"
new_course_part = "map((t,i)=>'<button class=\"lessonrow\" onclick=\"openCourseLesson('+selectedCourse+','+i+')\">"
assert old_course_part in content, 'old_course_part not found'
content = content.replace(old_course_part, new_course_part, 1)

course_lesson_fn = '''
function openCourseLesson(cIdx, lIdx) {
  selectedCourse = cIdx;
  if (cIdx === 0) {
    const pages = [1, 10, 12, 20];
    const p = pages[lIdx] || 1;
    if (typeof openCitation === 'function') {
      openCitation(p, 1, 'source-db');
    } else {
      readerPage = p;
      go('reader');
    }
  } else if (cIdx === 1) {
    const times = [0, 65, 125, 185];
    const t = times[lIdx] || 0;
    if (typeof openCitation === 'function') {
      openCitation(t, 1, 'default-video');
    } else {
      videoTime = t;
      go('video');
    }
  } else {
    go('reader');
  }
}
'''
content = content.replace('function openCourse(i){selectedCourse=i;go(\'course\')}', 'function openCourse(i){selectedCourse=i;go(\'course\')}' + course_lesson_fn, 1)

with open('kltn/frontend/source/core.js', 'w', encoding='utf-8', newline='\r\n') as f:
    f.write(content)

print('Successfully updated core.js!')
