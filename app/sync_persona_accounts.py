import argparse
import csv
from pathlib import Path

import app as webapp
from models import db, Account


EMPLOYEE_USERNAMES = {"somuchfun76", "bigcatobsessed", "limelover79"}

PERSONA_INTERESTS = {
    "somuchfun76": "safari logistics, luxury travel planning, ethical safaris, lodge standards, wildlife operations, private group itineraries, conservation partnerships, visa planning, high-end travel, wildlife photography ethics",
    "bigcatobsessed": "Masai Mara, big cat tracking, wildlife behavior, migration patterns, safari seasonality, ecosystem health, nature observation, field reports, predator movement, ethical guiding",
    "limelover79": "luxury safari planning, family safari, dietary accommodations, mobility-friendly travel, multigenerational trips, luxury lodges, private travel design, kids on safari, custom itineraries, safari concierge",
    "MossbackMeerkat": "wildlife photography gear, telephoto lenses, safari vehicle setups, gimbal heads, low-light photography, battery charging in camp, camera technique, photo portfolio building, bird photography, pro-level workshops",
    "TundraTortoise": "sustainable safari, conservation travel, ethical wildlife tourism, family education travel, community impact, wildlife NGOs, responsible lodges, children in nature, non-exploitative encounters, eco travel",
    "AtlasAlbatross79": "solo female travel, women photographers, safe safari travel, creative confidence, small group tours, mentorship travel, female-led trips, adventure travel, wildlife photography for beginners, Africa travel safety",
    "NomadNightingale4u": "private reserves, luxury safari, milestone travel, anniversary trip, exclusive lodges, uncrowded wildlife experiences, bespoke itineraries, high-service camps, bucket-list travel, VIP safari",
    "DriftwoodDingo": "rare mammals, specialist birding, leopard tracking, pangolins, maned wolf, wildlife taxonomy, field observation, natural history, niche safari guiding, conservation science",
    "coralcoyote94": "wellness safari, slow travel, nature retreats, mindfulness in nature, restorative travel, sensory travel, safari wellness lodges, meditation travel, quiet luxury, nature therapy",
    "RamblerEllie": "visual storytelling, wildlife cinematography, color grading, culture-rich travel, creative direction, narrative photography, unique safari angles, authentic travel content, atmospheric landscapes, story-driven shoots",
}


def resolve_csv_path(explicit_path=None):
    if explicit_path:
        path = Path(explicit_path)
        if path.exists():
            return path
        raise FileNotFoundError(f"Persona CSV not found: {path}")

    resolved = webapp._resolve_persona_csv_path()
    if not resolved:
        raise FileNotFoundError("No persona CSV was found in the workspace root or app/prompts.")
    return Path(resolved)


def build_personality(row):
    sections = [
        f"You are {row['Persona Name']}. {row['Description']}",
        f"Mindset: {row['Mindset']}",
        f"Behavior: {row['Subreddit Behavior']}",
        f"Tone: {row['Tone']}",
        f"Motivations/Goals: {row['Motivation']}",
        f"Mapped Benefit: {row['Mapped Benefit']}",
        f"Messaging Hook: {row['Messaging Hook']}",
    ]
    return "\n".join(section.strip() for section in sections if section and section.strip())


def sync_personas(csv_path, placeholder_password):
    rows = list(csv.DictReader(csv_path.open("r", encoding="utf-8")))

    created = []
    synced = []
    missing_interests = []

    with webapp.app.app_context():
        accounts_by_username = {account.username.lower(): account for account in Account.query.all()}

        for row in rows:
            username = (row.get("Persona Name") or "").strip()
            if not username:
                continue

            account = accounts_by_username.get(username.lower())
            if account is None:
                account = Account(username=username, password=placeholder_password)
                db.session.add(account)
                db.session.flush()
                accounts_by_username[username.lower()] = account
                created.append(username)

            account.persona_name = username
            account.personality = build_personality(row)
            account.interests = PERSONA_INTERESTS.get(username, "")
            account.role = "employee" if username in EMPLOYEE_USERNAMES else "customer"
            synced.append(username)

            if username not in PERSONA_INTERESTS:
                missing_interests.append(username)

        extra_account = accounts_by_username.get("cool_aleex")
        if extra_account is not None:
            extra_account.role = "inactive"

        db.session.commit()

    return {
        "csv_path": str(csv_path),
        "created": created,
        "synced": synced,
        "missing_interests": missing_interests,
        "inactive": ["cool_aleex"] if "cool_aleex" in accounts_by_username else [],
    }


def main():
    parser = argparse.ArgumentParser(description="Sync Reddit persona CSV data into account records.")
    parser.add_argument("--csv", help="Optional path to the persona CSV file")
    parser.add_argument(
        "--placeholder-password",
        default="TEMP_PASSWORD_CHANGE_ME",
        help="Password used when creating missing accounts",
    )
    args = parser.parse_args()

    csv_path = resolve_csv_path(args.csv)
    result = sync_personas(csv_path, args.placeholder_password)

    print(f"CSV: {result['csv_path']}")
    print(f"Created: {', '.join(result['created']) if result['created'] else 'none'}")
    print(f"Synced: {', '.join(result['synced']) if result['synced'] else 'none'}")
    print(f"Inactive: {', '.join(result['inactive']) if result['inactive'] else 'none'}")
    if result["missing_interests"]:
        print(f"Missing interests mapping: {', '.join(result['missing_interests'])}")


if __name__ == "__main__":
    main()
