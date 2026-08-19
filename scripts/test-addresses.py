"""
בדיקת 10 כתובות אקראיות דרך ה-API האמיתי.
בודק: האם העסקאות שמוחזרות מתאימות לרחוב שהוזן?
"""
import sys, json, random, urllib.request, urllib.error
sys.stdout.reconfigure(encoding='utf-8')

API = "http://localhost:3000/api/valuation"

with open('C:/leads/data/street-index.json', encoding='utf-8') as f:
    streets = json.load(f)
with open('C:/leads/data/deals.json', encoding='utf-8') as f:
    deals = json.load(f)

valid = [s for s in streets if s.get('neighborhoodId') and s.get('x') and s.get('y')]
random.seed(42)
test_streets = random.sample(valid, 10)

# בית מספרים ריאליסטיים לכל רחוב
HOUSE_NUMBERS = ["12", "24", "36", "8", "18", "44", "6", "30", "15", "22"]

print("=" * 80)
print("AUDIT: 10 random addresses — checking comparables match input street")
print("=" * 80)

results = []

for i, (street_data, house_num) in enumerate(zip(test_streets, HOUSE_NUMBERS)):
    street = street_data['street']
    neigh_id = street_data['neighborhoodId']
    neigh_name = street_data['neighborhoodName']
    x = street_data['x']
    y = street_data['y']

    payload = json.dumps({
        "neighborhoodId": neigh_id,
        "propertyType": "apartment",
        "rooms": 4,
        "areaSqm": 100,
        "floor": 3,
        "yearBuilt": "2000",
        "streetName": street,
        "houseNumber": house_num,
        "streetX": x,
        "streetY": y,
    }).encode()

    req = urllib.request.Request(
        API,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"\n[{i+1}] {street} {house_num} | {neigh_name}")
        print(f"     ERROR {e.code}: {body[:120]}")
        results.append({"street": street, "house": house_num, "status": "error", "error": body[:80]})
        continue
    except Exception as e:
        print(f"\n[{i+1}] {street} {house_num} — EXCEPTION: {e}")
        results.append({"street": street, "house": house_num, "status": "exception", "error": str(e)})
        continue

    v = data.get("valuation", {})
    comps = v.get("comparableDeals", [])
    scope = v.get("compSearchScope", "?")
    confidence = v.get("confidence", "?")
    n_deals = v.get("basedOnDeals", 0)
    estimate_low = v.get("estimateLow", 0)
    estimate_high = v.get("estimateHigh", 0)

    # בדוק כל comp — האם הרחוב תואם?
    # חשוב: עבור scope=radius/neighborhood זה מכוון שיהיו עסקאות מרחובות שונים.
    # באג אמיתי = scope=building/street עם עסקאות מרחוב אחר.
    def norm(s):
        for prefix in ["רחוב ", "שד' ", "שדרות ", "שדרת ", "הרב ", "דרך "]:
            s = s.replace(prefix, "")
        return s.strip().lower()

    mismatches = []
    data_issues = []
    for c in comps:
        comp_street = (c.get("street") or "").strip()
        comp_tier = c.get("tier", "?")

        # סמן מידע שגוי בנתונים
        if not comp_street or comp_street == "0":
            data_issues.append(f"tier={comp_tier} street='{comp_street}'")
            continue

        input_norm = norm(street)
        comp_norm = norm(comp_street)
        same_street = input_norm in comp_norm or comp_norm in input_norm

        # באג אמיתי: רק כשהtier הוא building/street ויש אי-התאמה
        if comp_tier in ("building", "street") and not same_street:
            mismatches.append({
                "comp_street": comp_street,
                "comp_house": c.get("houseNumber", ""),
                "tier": comp_tier,
                "price": c.get("price", 0),
            })

    # radius/neighborhood mismatches are expected — count separately for info
    radius_diff = []
    for c in comps:
        comp_street = (c.get("street") or "").strip()
        comp_tier = c.get("tier", "?")
        if comp_tier in ("radius", "neighborhood") and comp_street and comp_street != "0":
            input_norm = norm(street)
            comp_norm = norm(comp_street)
            if input_norm not in comp_norm and comp_norm not in input_norm:
                radius_diff.append(comp_street)

    status = "OK" if not mismatches else "BUG"
    flag = "✓" if not mismatches else "!! BUG"

    print(f"\n[{i+1}] {flag}  {street} {house_num} | {neigh_name}")
    print(f"     scope={scope} | confidence={confidence} | deals={n_deals} | estimate={estimate_low/1e6:.1f}M-{estimate_high/1e6:.1f}M NIS")
    print(f"     comps shown: {len(comps)}")

    if mismatches:
        print(f"     !! REAL BUG — building/street-scope comps from wrong street ({len(mismatches)}):")
        for m in mismatches[:5]:
            print(f"       comp street='{m['comp_street']}' #{m['comp_house']} | tier={m['tier']} | price={m['price']/1e6:.2f}M")
    else:
        comp_streets = list(set(c.get("street","?") for c in comps if c.get("street") and c.get("street") != "0"))
        print(f"     comp streets (sample): {comp_streets[:4]}")
    if data_issues:
        print(f"     [data quality] {len(data_issues)} comps with missing/bad street: {data_issues[:3]}")
    if radius_diff and scope in ("radius", "neighborhood"):
        unique_diff = list(set(radius_diff))
        print(f"     [expected] {len(radius_diff)} radius/neighborhood comps from other streets: {unique_diff[:3]}")

    results.append({
        "street": street,
        "house": house_num,
        "neigh": neigh_name,
        "scope": scope,
        "confidence": confidence,
        "n_deals": n_deals,
        "comps": len(comps),
        "mismatches": len(mismatches),
        "status": status,
    })

print("\n" + "=" * 80)
print("SUMMARY")
print("=" * 80)
ok  = sum(1 for r in results if r.get("status") == "OK")
bug = sum(1 for r in results if r.get("status") == "BUG")
err = sum(1 for r in results if r.get("status") in ("error","exception"))
print(f"OK: {ok}/10 | REAL BUGS (building/street scope wrong street): {bug}/10 | ERROR: {err}/10")

if bug > 0:
    print("\nBuggy addresses (scope=building/street with wrong-street comps):")
    for r in results:
        if r.get("status") == "BUG":
            print(f"  {r['street']} {r['house']} | {r['neigh']} | {r['mismatches']} wrong comps")
else:
    print("\nNo building/street scope bugs found. Radius/neighborhood comps from other streets are expected.")
