import pandas as pd
import json

file_path = "Wet_Market_Kobo_V4_23_Shop_Area_Added.xlsx"

# 1. Load Choices
choices_df = pd.read_excel(file_path, sheet_name='choices')
choices = {}
for _, row in choices_df.iterrows():
    list_name = str(row['list_name']).strip()
    if list_name == 'nan': continue
    if list_name not in choices:
        choices[list_name] = []
    choices[list_name].append({
        "name": str(row['name']),
        "label": str(row['label']),
        "old_zone_filter": str(row.get('old_zone_filter', '')),
        "circle_filter": str(row.get('circle_filter', ''))
    })

# 2. Load Survey Questions
survey_df = pd.read_excel(file_path, sheet_name='survey')
questions = []

for _, row in survey_df.iterrows():
    q_type = str(row['type']).strip()

    # We KEEP calculate for math, and actual inputs
    if q_type == 'nan' or q_type in ['note', 'begin_group', 'end_group']:
        continue

    q = {
        "id": str(row['name']).strip(),
        "label": str(row['label']).strip() if pd.notna(row['label']) else "",
        "type": q_type,
        "required": str(row['required']).strip().lower() == 'yes',
        "hint": str(row['hint']).strip() if pd.notna(row['hint']) else "",
        "calculation": str(row['calculation']).strip() if pd.notna(row['calculation']) else "",
        "relevant": str(row['relevant']).strip() if pd.notna(row['relevant']) else ""
    }

    # Extract choices
    if q_type.startswith('select_one ') or q_type.startswith('select_multiple '):
        list_name = q_type.split(' ')[1]
        q["options"] = choices.get(list_name, [])

    questions.append(q)

with open('../frontend/src/surveyConfig.json', 'w', encoding='utf-8') as f:
    json.dump(questions, f, indent=2)

print(f"Generated surveyConfig.json with {len(questions)} items (including calculations)!")