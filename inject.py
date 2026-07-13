import re

cinematic = ["KMFnndJg9fI", "SWb05aNAMrA", "hFLSSvpBQ-8", "3iZnzimK9J8", "Yj_nPJwdzZk", "okxZX4lyjqs", "SAzWTwtb_Co", "Wnx97hc4Mg0", "Jc99XGNOJMs", "3Fdh9k2csts", "-Y9VASE_aBM", "ZdSYOzSX7uw", "1v5cyzlHIDU", "r-slfooanp4", "dn50GfOZeYs", "lCMkxB5GO-I", "1wkU8so5mks", "ybH3YFwHaFA", "OVHPP39wY0U", "4EH2MRIaviU", "k-zn2XiLQF8", "oQusqtMm8lI", "oab4LVr6ym0"]
aerial = ["g0NZo6CA8bM", "ITTWGUSdit8", "z9bXqWcxdeE", "-mrqcsKnPbk", "TbHtuxUIAk0", "njxSr04AcUs", "5QHEfA3P6rQ", "R1mGSoXhxzw", "ayYk_1E_ALg", "o0fjmemjqIA", "AahMXJXCk_w", "_c3YwY79loY"]
land = ["w6i5zEo2uZA", "2XRJCRDycSo", "fmAYD4PyZVE", "q2xeKELZGIA", "W7btDd0AorA", "xQytvdvCS6U"]
creative_promo = ["mf9nG-6Jpyw"]
creative_music = ["Vjw8eQH6OPI"]
creative_event = ["sEbbhFBNKsI"]
weddings = ["BZDdwXOhf6k", "vmF2anBsGDo", "CsbUvCDOb0A"]

def make_grid(ids):
    return '\n'.join([f'        <div class="lite-youtube" data-id="{i}" style="height: 250px; border: 1px solid var(--accent-gold);"></div>' for i in ids])

# 1. portfolio/real-estate.html
with open('portfolio/real-estate.html', 'r', encoding='utf-8') as f:
    html = f.read()

html = re.sub(r'(<h2[^>]*>Cinematic Property Showcase Videos</h2>\s*<div class="feature-grid">)(.*?)(</div>\s*</div>\s*<!-- 2. AERIAL-ONLY)', lambda m: m.group(1) + '\n' + make_grid(cinematic) + '\n      ' + m.group(3), html, flags=re.DOTALL)
html = re.sub(r'(<h2[^>]*>Aerial-Only Property Videos</h2>\s*<div class="feature-grid">)(.*?)(</div>\s*</div>\s*<!-- 3. AERIAL LAND)', lambda m: m.group(1) + '\n' + make_grid(aerial) + '\n      ' + m.group(3), html, flags=re.DOTALL)
html = re.sub(r'(<h2[^>]*>Aerial Land Videos</h2>\s*<div class="feature-grid">)(.*?)(</div>\s*</div>\s*<!-- 4. FREE PROPERTY)', lambda m: m.group(1) + '\n' + make_grid(land) + '\n      ' + m.group(3), html, flags=re.DOTALL)

p_links = [
    "https://medialab.aryeo.com/sites/18549-landridge-way-abingdon-va-24211-16146235/branded",
    "https://medialab.aryeo.com/sites/20350-lizmarye-ln-abingdon-va-24211-20152706/branded",
    "https://medialab.aryeo.com/sites/7464-callalantee-dr-mountain-city-tn-37683-19932395/branded"
]
idx = [0]
def rep_link(m):
    if idx[0] < 3:
        l = p_links[idx[0]]
        idx[0] += 1
        return m.group(0).replace('href="#"', f'href="{l}" target="_blank"')
    return m.group(0)

match_area = re.search(r'(<h2[^>]*>Free Property Listing Page Examples</h2>.*?)<!-- 5. FREE', html, flags=re.DOTALL)
if match_area:
    area = match_area.group(1)
    new_area = re.sub(r'<a href="#" style="text-decoration: none;">', rep_link, area)
    html = html.replace(area, new_area)

with open('portfolio/real-estate.html', 'w', encoding='utf-8') as f:
    f.write(html)


# 2. portfolio/creative.html
with open('portfolio/creative.html', 'r', encoding='utf-8') as f:
    html = f.read()

html = re.sub(r'(<h2[^>]*>Commercial / Branding</h2>\s*<div class="feature-grid">)(.*?)(</div>\s*</div>)', lambda m: m.group(1) + '\n' + make_grid(creative_promo) + '\n      ' + m.group(3), html, flags=re.DOTALL)
html = re.sub(r'(<h2[^>]*>Music Videos</h2>\s*<div class="feature-grid">)(.*?)(</div>\s*</div>)', lambda m: m.group(1) + '\n' + make_grid(creative_music) + '\n      ' + m.group(3), html, flags=re.DOTALL)
html = re.sub(r'(<h2[^>]*>Event Coverage</h2>\s*<div class="feature-grid"[^>]*>)(.*?)(</div>\s*</div>)', lambda m: m.group(1) + '\n' + make_grid(creative_event) + '\n      ' + m.group(3), html, flags=re.DOTALL)
html = re.sub(r'(<h2[^>]*>Wedding Films</h2>.*?(?:<div class="feature-grid"[^>]*>))(.*?)(</div>\s*</div>)', lambda m: m.group(1) + '\n' + make_grid(weddings) + '\n      ' + m.group(3), html, flags=re.DOTALL)

with open('portfolio/creative.html', 'w', encoding='utf-8') as f:
    f.write(html)


# 3. weddings.html
with open('weddings.html', 'r', encoding='utf-8') as f:
    html = f.read()

html = re.sub(r'(<div class="feature-grid" style="gap: 3rem;">\s*<!-- NOTE TO USER: Replace[^>]*>\s*)(.*?)(</div>\s*<div class="text-center mt-5">)', lambda m: m.group(1) + '\n' + '\n'.join([f'      <div class="lite-youtube" data-id="{i}" style="border: 1px solid var(--accent-gold); box-shadow: 0 10px 30px rgba(0,0,0,0.5);"></div>' for i in weddings]) + '\n    ' + m.group(3), html, flags=re.DOTALL)

vidflow = '''<div style="background: var(--bg-primary); max-width: 800px; margin: 0 auto; border-radius: 8px; overflow: hidden; border: 1px solid var(--accent-gold);">
        <div style="position: relative; padding: 20px; height: 650px;">
          <iframe style="position: absolute; top: 0; left: 0; width: 125%; height: 125%; zoom: 0.8; transform: scale(0.8); -webkit-transform: scale(0.8); transform-origin: 0 0; -webkit-transform-origin: 0 0;" src="https://galleries.vidflow.co/embed/d/f9hfquf1" frameborder="0" allowfullscreen webkitallowfullscreen mozallowfullscreen></iframe>
        </div>
      </div>'''
html = re.sub(r'<div style="background:.*?\[ VidFlow Gallery Integration Coming Soon \].*?</div>', vidflow, html, flags=re.DOTALL)

honeybook = '''<div class="hb-p-65647b211769020008c5cf07-1"></div><img height="1" width="1" style="display:none" src="https://www.honeybook.com/p.png?pid=65647b211769020008c5cf07"> <script> (function(h,b,s,n,i,p,e,t) { h._HB_ = h._HB_ || {};h._HB_.pid = i;;;; t=b.createElement(s);t.type="text/javascript";t.async=!0;t.src=n; e=b.getElementsByTagName(s)[0];e.parentNode.insertBefore(t,e); })(window,document,"script","https://widget.honeybook.com/assets_users_production/websiteplacements/placement-controller.min.js","65647b211769020008c5cf07"); </script>'''
html = re.sub(r'<!-- NOTE TO USER: PASTE HONEYBOOK.*?\[HoneyBook Embed Code Goes Here\]\s*</div>', honeybook, html, flags=re.DOTALL)

with open('weddings.html', 'w', encoding='utf-8') as f:
    f.write(html)


# 4. real-estate.html
with open('real-estate.html', 'r', encoding='utf-8') as f:
    html = f.read()

aryeo_order = '''<div data-embed-url="https://medialab.aryeo.com/order"><script src="https://medialab.aryeo.com/embeds/medialab"></script></div>'''
html = re.sub(r'<!-- NOTE TO USER: PASTE ARYEO.*?\[Aryeo Embed Code Goes Here\]\s*</div>', aryeo_order, html, flags=re.DOTALL)

with open('real-estate.html', 'w', encoding='utf-8') as f:
    f.write(html)


# 5. login.html
with open('login.html', 'r', encoding='utf-8') as f:
    html = f.read()

aryeo_login = '''<div style="width: 100%; max-width: 600px; border-radius: 8px; min-height: 500px; border: 1px solid #333; box-shadow: 0 4px 20px rgba(0,0,0,0.5); overflow: hidden;">
      <iframe src="https://medialab.aryeo.com/portal" style="width: 100%; height: 800px; border: none;"></iframe>
    </div>'''
html = re.sub(r'<!-- NOTE TO USER: PASTE ARYEO LOGIN.*?Replaces this entire white container</span>\s*</p>\s*</div>', aryeo_login, html, flags=re.DOTALL)

with open('login.html', 'w', encoding='utf-8') as f:
    f.write(html)

print("INJECTION COMPLETE")
