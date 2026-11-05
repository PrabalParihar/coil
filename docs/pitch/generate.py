#!/usr/bin/env python3
"""Rebuild the honest 112-second text-guided pitch, PDF and PPTX from slides.json.

Requires Pillow, reportlab, python-pptx, ffmpeg and ffprobe. No network, keys or
chain writes. Source captures are illustrations, never receipt evidence.
Run from any directory: python docs/pitch/generate.py
"""
import json
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from pptx import Presentation
from pptx.util import Inches
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
FRAMES = HERE / 'frames'
FRAMES.mkdir(exist_ok=True)
SLIDES = json.loads((HERE / 'slides.json').read_text())
W, H = 1600, 900
BG = '#10191e'
PANEL = '#19272d'
INK = '#f4f0e5'
MUTED = '#b6c2c3'
GOLD = '#ffba52'
GREEN = '#8fd4b5'
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

def font(size, bold=False):
    return ImageFont.truetype(BOLD if bold else FONT, size)

def wrap(draw, value, size, width, bold=False):
    words, rows, line = value.split(), [], ''
    for word in words:
        trial = f'{line} {word}'.strip()
        if draw.textlength(trial, font=font(size, bold)) > width and line:
            rows.append(line)
            line = word
        else:
            line = trial
    if line:
        rows.append(line)
    return rows

def paragraph(draw, value, xy, size=29, width=1410, fill=INK, bold=False, spacing=1.35):
    x, y = xy
    for row in wrap(draw, value, size, width, bold):
        draw.text((x, y), row, font=font(size, bold), fill=fill)
        y += int(size * spacing)
    return y

def box(draw, xy, fill=PANEL, outline=None, radius=20):
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=2)

def make_frame(slide, index):
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, W, 10), fill=GOLD)
    d.text((84, 51), slide['kicker'], font=font(21, True), fill=GOLD)
    d.text((1475, 51), f'{index + 1:02d}', font=font(23, True), fill=MUTED)
    title_end = paragraph(d, slide['title'], (84, 120), size=54, bold=True, width=1390, spacing=1.18)
    body_y = max(255, title_end + 22)
    paragraph(d, slide['body'], (84, body_y), size=29, width=1400, fill=MUTED)
    card_y = 430
    # Three sequential product/action cards form a stable visual grammar.
    card_w = 442
    for j, (label, detail) in enumerate(slide['cards']):
        x = 84 + j * 493
        box(d, (x, card_y, x + card_w, card_y + 192), outline='#314249')
        d.text((x + 24, card_y + 22), f'0{j + 1}', font=font(19, True), fill=GREEN)
        paragraph(d, label, (x + 24, card_y + 57), size=30, width=card_w - 48, bold=True, fill=GOLD)
        paragraph(d, detail, (x + 24, card_y + 108), size=23, width=card_w - 48, fill=INK)
        if j < 2:
            d.line((x + card_w + 12, card_y + 94, x + card_w + 35, card_y + 94), fill=GOLD, width=3)
            d.polygon([(x + card_w + 35, card_y + 94), (x + card_w + 28, card_y + 88), (x + card_w + 28, card_y + 100)], fill=GOLD)
    box(d, (64, 660, 1536, 800), fill='#22333a')
    d.text((88, 678), 'ON-SCREEN GUIDE', font=font(17, True), fill=GREEN)
    end = paragraph(d, slide['guide'], (88, 710), size=26, width=1410, spacing=1.3)
    if end > 798:
        raise ValueError(f'Guide overflows slide {index + 1}: {end}')
    d.text((84, 837), 'ILLUSTRATIVE WALKTHROUGH  |  RELEASE CANDIDATE  |  NOT CHAIN PROOF', font=font(18, True), fill=GOLD)
    # Show timing as a reading cue; total is authored, not a truncated recording.
    start = sum(s['seconds'] for s in SLIDES[:index])
    d.text((1390, 837), f'{start:02d}-{start + slide["seconds"]:02d}s', font=font(18), fill=MUTED)
    p = FRAMES / f'{index + 1:02d}.png'
    im.save(p)
    return p

paths = [make_frame(slide, i) for i, slide in enumerate(SLIDES)]
def timestamp(seconds):
    return f'{seconds // 3600:02d}:{seconds % 3600 // 60:02d}:{seconds % 60:02d},000'

subtitles = []
start = 0
for i, slide in enumerate(SLIDES):
    end = start + slide['seconds']
    subtitles.extend([str(i + 1), f'{timestamp(start)} --> {timestamp(end)}', slide['guide'], ''])
    start = end
(HERE / 'coil-wave2-pitch.srt').write_text('\n'.join(subtitles))
# Portable presentation artifacts use exactly the inspected frames. Their
# editable source is slides.json plus this renderer; PPTX notes carry source text.
pdf_path = HERE / 'coil-wave2-deck.pdf'
c = canvas.Canvas(str(pdf_path), pagesize=(W, H))
c.setTitle('Coil Labs | Wave 2 release candidate')
c.setAuthor('Prabal Pratap Singh, Nikhil Verma, Neha Singh')
for p in paths:
    c.drawImage(ImageReader(str(p)), 0, 0, W, H)
    c.showPage()
c.save()
prs = Presentation()
prs.slide_width, prs.slide_height = Inches(16), Inches(9)
prs.core_properties.title = 'Coil Labs | Wave 2 release candidate'
prs.core_properties.author = 'Prabal Pratap Singh, Nikhil Verma, Neha Singh'
for p, slide in zip(paths, SLIDES):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    s.shapes.add_picture(str(p), 0, 0, width=prs.slide_width, height=prs.slide_height)
    s.notes_slide.notes_text_frame.text = '\n\n'.join([slide['title'], slide['body'], slide['guide'], 'Illustrative release candidate. Historical receipts: ../../DEPLOYMENTS.md. No new on-chain proof.'])
prs.save(str(HERE / 'coil-wave2-deck.pptx'))
# A labelled full-image contact sheet preserves source fidelity; no placeholder
# transaction hash in a redesigned capture is treated as receipt evidence.
screens_dir = ROOT / 'docs/evidence/screenshots'
screens_dir.mkdir(parents=True, exist_ok=True)
for name in ['02-connect-preview.png', '04-position-after-loop.png', '06-unwind.png']:
    source = Image.open(ROOT / 'docs/media' / name).convert('RGB')
    thumb = source.copy()
    thumb.thumbnail((1050, 1570))
    sheet = Image.new('RGB', (1200, 1800), BG)
    sd = ImageDraw.Draw(sheet)
    sd.text((50, 35), 'ILLUSTRATIVE LEGACY UI', font=font(37, True), fill=GOLD)
    sd.text((50, 95), 'MATSNET 31611  |  NOT TRANSACTION PROOF', font=font(24, True), fill=INK)
    sd.text((50, 140), 'Static redesign capture; placeholder hashes may appear.', font=font(23), fill=MUTED)
    sheet.paste(thumb, ((1200 - thumb.width) // 2, 195))
    sd.text((50, 1755), 'Source: docs/media/' + name, font=font(20), fill=MUTED)
    sheet.save(screens_dir / name)
# Contact sheet for human deck-page inspection.
contact = Image.new('RGB', (1600, 1800), '#d3d7d4')
for i, p in enumerate(paths):
    tile = Image.open(p).resize((800, 450))
    contact.paste(tile, ((i % 2) * 800, (i // 2) * 450))
contact.save(HERE / 'deck-contact-sheet.png')
# Each scene lasts a deliberate 14 seconds. Concat does not truncate source media.
concat = HERE / 'frames.ffconcat'
concat.write_text('ffconcat version 1.0\n' + ''.join(f"file 'frames/{i+1:02d}.png'\nduration {s['seconds']}\n" for i, s in enumerate(SLIDES)) + f"file 'frames/{len(SLIDES):02d}.png'\n")
total = sum(s['seconds'] for s in SLIDES)
subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-safe', '0', '-i', str(concat), '-vf', 'fps=24,scale=1600:900,format=yuv420p', '-t', str(total), '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-movflags', '+faststart', str(HERE / 'coil-wave2-pitch.mp4')], check=True)
probe = subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration,size:stream=codec_name,width,height,avg_frame_rate', '-of', 'json', str(HERE / 'coil-wave2-pitch.mp4')], text=True)
print(probe)
print(f'Created {len(paths)} deck pages and authored {total}-second text-guided pitch.')
