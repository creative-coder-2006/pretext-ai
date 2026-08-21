# Regenerates Abhinav's resume as a clean one-page, two-column PDF, adding the
# Pretext Chrome-extension project plus the agreed skill/summary tweaks.
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_LEFT, TA_JUSTIFY
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, KeepInFrame,
)
from reportlab.lib.styles import ParagraphStyle

OUT = r"C:\Users\abhin\Downloads\Abhinav_Botlaguduru_Resume.pdf"

INK = HexColor("#1A2433")       # near-black body
ACCENT = HexColor("#2B557E")    # steel blue headers
MUTED = HexColor("#5B6677")     # subtitles / dates
RULE = HexColor("#C9D3DF")      # thin rules

styles = {}
styles["name"] = ParagraphStyle("name", fontName="Helvetica-Bold", fontSize=21,
    textColor=INK, leading=23, spaceAfter=2)
styles["title"] = ParagraphStyle("title", fontName="Helvetica", fontSize=10.5,
    textColor=ACCENT, leading=13, spaceAfter=4)
styles["contact"] = ParagraphStyle("contact", fontName="Helvetica", fontSize=8.6,
    textColor=MUTED, leading=12)
styles["h"] = ParagraphStyle("h", fontName="Helvetica-Bold", fontSize=10.5,
    textColor=ACCENT, leading=12, spaceBefore=2, spaceAfter=3,
    tracking=0.5)
styles["body"] = ParagraphStyle("body", fontName="Helvetica", fontSize=8.7,
    textColor=INK, leading=11.6, alignment=TA_JUSTIFY)
styles["role"] = ParagraphStyle("role", fontName="Helvetica-Bold", fontSize=9.4,
    textColor=INK, leading=11.5, spaceBefore=3)
styles["sub"] = ParagraphStyle("sub", fontName="Helvetica-Oblique", fontSize=8.5,
    textColor=MUTED, leading=11)
styles["sb_item"] = ParagraphStyle("sb_item", fontName="Helvetica", fontSize=8.6,
    textColor=INK, leading=11)
styles["sb_strong"] = ParagraphStyle("sb_strong", fontName="Helvetica-Bold", fontSize=8.7,
    textColor=INK, leading=11.5, spaceBefore=2)
styles["sb_muted"] = ParagraphStyle("sb_muted", fontName="Helvetica", fontSize=8.0,
    textColor=MUTED, leading=10.5, spaceAfter=2)


def section(title):
    return [Paragraph(title.upper(), styles["h"]),
            HRFlowable(width="100%", thickness=0.8, color=RULE,
                       spaceBefore=1, spaceAfter=4)]


def main():
    page_w, page_h = A4
    lm = rm = 14 * mm
    tm = 12 * mm
    bm = 10 * mm

    doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=lm, rightMargin=rm,
                          topMargin=tm, bottomMargin=bm, title="Abhinav Botlaguduru — Resume",
                          author="Abhinav Botlaguduru")
    frame = Frame(lm, bm, page_w - lm - rm, page_h - tm - bm, id="full",
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates([PageTemplate(id="main", frames=[frame])])

    story = []

    # ---- Header -----------------------------------------------------------
    story.append(Paragraph("ABHINAV BOTLAGUDURU", styles["name"]))
    story.append(Paragraph("Computer Science Undergraduate &nbsp;·&nbsp; Data Science", styles["title"]))
    contact = ('+91 73968 91549 &nbsp;|&nbsp; '
               '<a href="mailto:abhinavbotlaguduru@gmail.com" color="#2B557E">abhinavbotlaguduru@gmail.com</a> &nbsp;|&nbsp; '
               '<a href="https://www.linkedin.com/in/abhinav-botlaguduru-8b4992309/" color="#2B557E">linkedin.com/in/abhinav-botlaguduru</a> &nbsp;|&nbsp; '
               'Hyderabad, Telangana')
    story.append(Paragraph(contact, styles["contact"]))
    story.append(Spacer(1, 4))
    story.append(HRFlowable(width="100%", thickness=1.1, color=ACCENT, spaceAfter=7))

    # ---- Right (main) column ---------------------------------------------
    main_col = []
    main_col += section("Summary")
    summary = ("Second-year Computer Science undergraduate at Manipal Academy of Higher "
               "Education, Bengaluru, specializing in Data Science. Programming since 7th grade, "
               "with strong proficiency in Python and SQL and growing depth in TypeScript and "
               "full-stack development. Recently designed and shipped <b>Pretext</b>, an AI-powered "
               "Chrome extension that optimizes prompts inline for any LLM. Continually exploring "
               "new tools and ideas across data science and AI, and eager to keep learning, "
               "building, and contributing to impactful tech.")
    main_col.append(Paragraph(summary, styles["body"]))
    main_col.append(Spacer(1, 6))

    main_col += section("Experience")
    main_col.append(Paragraph("AI Developer Intern — Zetta Farms", styles["role"]))
    main_col.append(Paragraph("04/2025 – 07/2025", styles["sub"]))
    main_col.append(Spacer(1, 1))
    zetta = ("Built a production WhatsApp chatbot enabling farm staff to submit daily task reports "
             "(DTS) in natural language over WhatsApp. Engineered a Node.js + Express backend that "
             "receives messages through WhatsApp Business API webhooks and uses an OpenAI LLM, "
             "combined with string-similarity matching, to parse free-form updates into structured "
             "records stored in a Supabase (PostgreSQL) database. Implemented Redis-backed caching "
             "and request rate-limiting, JWT authentication, and Helmet security middleware, and "
             "contributed to an admin portal for monitoring submissions and farm operations.")
    main_col.append(Paragraph(zetta, styles["body"]))
    main_col.append(Spacer(1, 6))

    main_col += section("Education")
    main_col.append(Paragraph("B.Tech, Computer Science (Data Science)", styles["role"]))
    main_col.append(Paragraph("Manipal Academy of Higher Education, Bengaluru &nbsp;·&nbsp; 08/2024 – 05/2028", styles["sub"]))
    main_col.append(Paragraph("High School", styles["role"]))
    main_col.append(Paragraph("Meridian School, Hyderabad &nbsp;·&nbsp; 05/2022 – 02/2024", styles["sub"]))
    main_col.append(Spacer(1, 6))

    main_col += section("Projects")
    main_col.append(Paragraph("Pretext — Inline AI Prompt Autocomplete Engine", styles["role"]))
    main_col.append(Spacer(1, 1))
    pretext = ("Built a Chrome extension (Manifest V3) that transforms vague user text into "
               "hyper-specific, context-rich prompts directly inside any AI chat interface "
               "(ChatGPT, Claude, Gemini). On a Ctrl/Cmd+K hotkey, it routes the text to an "
               "ultra-low-latency LLM (Groq's llama-3.1-8b-instant in strict JSON mode) and renders "
               "an interactive fill-in-the-blank canvas with highlighted token pills and AI-generated "
               "dropdown options that the user tabs through before injecting the optimized prompt back "
               "into the page. Developed with TypeScript, WXT + Vite, and a Shadow DOM + Tailwind CSS "
               "UI for full style isolation, backed by a Supabase (PostgreSQL) layer for Google OAuth, "
               "session management, and token-usage analytics, with a serverless edge-function proxy "
               "safeguarding API keys.")
    main_col.append(Paragraph(pretext, styles["body"]))

    main_col.append(Paragraph("Urban Intelligence Dashboard", styles["role"]))
    main_col.append(Spacer(1, 1))
    urban = ("Developed an AI-powered dashboard that lets users select a city and view key "
             "demographic data, local issues with proposed solutions, and satellite imagery "
             "(vegetation, water bodies, urbanization) over time. Used Plotly, Seaborn, and "
             "Matplotlib for interactive visualizations, and implemented machine-learning algorithms "
             "to generate city-specific, actionable insights for urban planning, resource management, "
             "environmental sustainability, and biodiversity conservation.")
    main_col.append(Paragraph(urban, styles["body"]))

    main_col.append(Paragraph("YouTube Channel Data Management System", styles["role"]))
    main_col.append(Spacer(1, 1))
    yt = ("Engineered a data-driven YouTube channel management and analytics system using Python and "
          "SQL to process and analyze high-impact performance metrics for the top 15 global channels. "
          "Employed Pandas and NumPy for advanced data wrangling, Matplotlib for multi-dimensional "
          "visualizations, and structured queries to optimize data retrieval and segmentation — "
          "enabling insight generation across ranking algorithms, viewer distribution, content "
          "categorization, regional trends, and subscriber growth patterns.")
    main_col.append(Paragraph(yt, styles["body"]))

    # ---- Left (sidebar) column -------------------------------------------
    side = []
    side += section("Technical Skills")
    for s in ["Advanced Python",
              "Intermediate SQL (1 yr)", "REST APIs &amp; LLM Integration",
              "Intermediate C", "Basic Java"]:
        side.append(Paragraph("•&nbsp; " + s, styles["sb_item"]))
    side.append(Spacer(1, 6))

    side += section("Languages")
    for lang, lvl in [("English", "Proficient"), ("Telugu", "Advanced"), ("Hindi", "Advanced")]:
        side.append(Paragraph(f"{lang} <font color='#5B6677'>— {lvl}</font>", styles["sb_item"]))
    side.append(Spacer(1, 6))

    side += section("Certifications")
    side.append(Paragraph("Python for Data Science, AI &amp; Development", styles["sb_strong"]))
    side.append(Paragraph("IBM", styles["sb_muted"]))
    side.append(Paragraph("Fundamentals of Java Programming", styles["sb_strong"]))
    side.append(Paragraph("Board Infinity", styles["sb_muted"]))
    side.append(Spacer(1, 6))

    side += section("Achievements")
    side.append(Paragraph("BECon '26, IIT Delhi", styles["sb_strong"]))
    side.append(Paragraph("Finalist", styles["sb_muted"]))
    side.append(Spacer(1, 6))

    side += section("Volunteering & Leadership")
    side.append(Paragraph("Executive Member", styles["sb_strong"]))
    side.append(Paragraph("Office of Alumni Relations, MIT Bengaluru · 01/2026 – Present", styles["sb_muted"]))
    side.append(Paragraph("Organizing Committee", styles["sb_strong"]))
    side.append(Paragraph("Human Resources · Tech Solstice '26", styles["sb_muted"]))
    side.append(Paragraph("Organizing Committee", styles["sb_strong"]))
    side.append(Paragraph("Human Resources · Falak '25", styles["sb_muted"]))

    # ---- Two-column body --------------------------------------------------
    gutter = 7 * mm
    avail = page_w - lm - rm
    side_w = 62 * mm
    main_w = avail - side_w - gutter

    body = Table(
        [[KeepInFrame(side_w, page_h, side, mode="shrink"),
          "",
          KeepInFrame(main_w, page_h, main_col, mode="shrink")]],
        colWidths=[side_w, gutter, main_w],
    )
    body.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("LINEAFTER", (0, 0), (0, 0), 0.6, RULE),
        ("LEFTPADDING", (2, 0), (2, 0), 5),
    ]))
    story.append(body)

    doc.build(story)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
