#!/usr/bin/env python3
"""اعمال بازطراحی v6 روی index.html اصلی (قابل تکرار؛ همیشه از نسخه پشتیبان شروع می‌کند)."""
import sys, re
SRC, CSS, DST = sys.argv[1:4]
t = open(SRC, encoding='utf-8').read()
css = open(CSS, encoding='utf-8').read()

def must_replace(s, old, new, count=1):
    assert s.count(old) >= 1, 'pattern not found: ' + old[:70]
    return s.replace(old, new, count)

b = t.index('<body>')
head, body = t[:b], t[b:]

# 1) داشبورد: عنوان بخش «وضعیت امروز» و بلوک «کارهای روزانه» (فقط دکمه‌هایی که showSection را صدا می‌زنند)
primary = '''
    <div class="dash-section-title">کارهای روزانه</div>
    <div class="dash-primary">
        <button type="button" onclick="showSection('attendance')"><span class="dp-ico" aria-hidden="true">✓</span><b>حضور و غیاب</b><small>ثبت وضعیت امروز</small></button>
        <button type="button" onclick="showSection('students')"><span class="dp-ico" aria-hidden="true">♟</span><b>دانش‌آموزان</b><small>فهرست و پرونده‌ها</small></button>
        <button type="button" onclick="showSection('homework')"><span class="dp-ico" aria-hidden="true">▤</span><b>تکالیف</b><small>ثبت و پیگیری</small></button>
        <button type="button" onclick="showSection('evaluation')"><span class="dp-ico" aria-hidden="true">★</span><b>ارزشیابی</b><small>ثبت نمره و سطح</small></button>
    </div>

    <div class="dash-section-title">وضعیت کلاس</div>
'''
body = must_replace(body, '    <div class="dashboard-quick">', primary + '    <div class="dashboard-quick">')

# 2) بلوک نمایشی (میانبرها و پیش‌نمایش جدول‌ها) → بخش جمع‌شونده «برنامه‌ریزی و بودجه‌بندی»
body = must_replace(body, '    <div class="dashboard-showcase">',
  '    <details class="dash-more"><summary>برنامه‌ریزی و بودجه‌بندی</summary><div class="dash-more-body">\n    <div class="dashboard-showcase">')
body = must_replace(body, '''    <div class="card" style="margin-top:18px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">''',
  '''    </div></details>

    <details class="dash-more"><summary>همه امکانات کلاس</summary><div class="dash-more-body">
    <div class="card dash-cap-card">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">''')
# پایان کارت قابلیت‌ها (درست قبل از dashboard-two)
body = must_replace(body, '''        </div>
    </div>

    <div class="dashboard-two">''', '''        </div>
    </div>
    </div></details>

    <div class="dashboard-two">''')

# 3) لایه طراحی v6 جایگزین استایل نیمه‌باز انتهای فایل می‌شود
tail_bad = '<style id="ui-refresh-v9">\n</html>'
assert body.rstrip().endswith(tail_bad), 'unexpected file tail'
body = body.rstrip()[:-len(tail_bad)] + '<style id="design-system-v6">\n' + css + '\n/* حذف نمایش عنوان داخلی کارت قابلیت‌ها در حالت جمع‌شونده */\n.dash-cap-card{border:0!important;padding:0!important;margin:0!important;box-shadow:none!important;background:transparent!important}\n.dash-cap-card > div:first-child{display:none!important}\n</style>\n</html>\n'

open(DST, 'w', encoding='utf-8').write(head + body)
print('written', DST, len(head + body))
