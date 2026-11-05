#!/usr/bin/env python3
"""Validate local materials only. This never marks funded release evidence ready."""
import hashlib
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
import fitz
import jsonschema
from PIL import Image, ImageChops, ImageStat
from pptx import Presentation
from pypdf import PdfReader

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUTPUT = ROOT / 'docs/evidence/artifact-validation.json'
slides = json.loads((HERE / 'slides.json').read_text())
expected_duration = sum(s['seconds'] for s in slides)
assert len(slides) == 8 and 0 < expected_duration <= 120
probe = json.loads(subprocess.check_output([
    'ffprobe', '-v', 'error', '-show_entries',
    'format=duration,size:stream=codec_name,width,height,avg_frame_rate',
    '-of', 'json', str(HERE / 'coil-wave2-pitch.mp4')], text=True))
assert abs(float(probe['format']['duration']) - expected_duration) < 0.05
assert probe['streams'][0]['codec_name'] == 'h264'
assert (probe['streams'][0]['width'], probe['streams'][0]['height']) == (1600, 900)
assert len(probe['streams']) == 1, 'The text-guided asset must not claim recorded narration.'
assert len(PdfReader(HERE / 'coil-wave2-deck.pdf').pages) == len(slides)
assert len(Presentation(HERE / 'coil-wave2-deck.pptx').slides) == len(slides)
ledger = json.loads((ROOT / 'docs/evidence/tester-proofs.json').read_text())
schema = json.loads((ROOT / 'docs/evidence/tester-proofs.schema.json').read_text())
jsonschema.Draft202012Validator.check_schema(schema)
jsonschema.validate(ledger, schema)
assert ledger == {'schemaVersion': 1, 'chainId': 31611, 'factory': None,
                  'deploymentBlock': None, 'testers': [], 'receipts': []}
# Render every actual PDF page, then sample each authored video scene at midpoint.
# This verifies both export pipelines against the source, rather than inspecting
# only source PNGs and assuming that the PDF/video contain them.
pdf = fitz.open(HERE / 'coil-wave2-deck.pdf')
contact = Image.new('RGB', (1600, 1800), '#d3d7d4')
video_contact = contact.copy()
sample_dir = ROOT / 'docs/evidence/video-samples'
sample_dir.mkdir(exist_ok=True)
comparisons = []
start = 0
for i, (page, slide) in enumerate(zip(pdf, slides)):
    pix = page.get_pixmap(matrix=fitz.Matrix(1, 1))
    rendered = Image.frombytes('RGB', [pix.width, pix.height], pix.samples)
    source = Image.open(HERE / f'frames/{i+1:02d}.png').convert('RGB')
    pdf_rms = sum(ImageStat.Stat(ImageChops.difference(rendered, source)).rms) / 3
    assert pdf_rms < 1, (i, 'PDF differs from source', pdf_rms)
    rendered.resize((800, 450)).save(HERE / f'frames/pdf-page-{i+1:02d}.png')
    contact.paste(rendered.resize((800, 450)), ((i % 2) * 800, (i // 2) * 450))
    sample = sample_dir / f'{i+1:02d}.png'
    midpoint = start + slide['seconds'] / 2
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-ss', str(midpoint),
                    '-i', str(HERE / 'coil-wave2-pitch.mp4'), '-frames:v', '1', str(sample)], check=True)
    sampled = Image.open(sample).convert('RGB')
    video_rms = sum(ImageStat.Stat(ImageChops.difference(sampled, source)).rms) / 3
    assert video_rms < 7, (i, 'Video scene mismatch', video_rms)
    video_contact.paste(sampled.resize((800, 450)), ((i % 2) * 800, (i // 2) * 450))
    comparisons.append({'page': i+1, 'sampleSecond': midpoint,
                        'pdfRgbRmsDifference': round(pdf_rms, 4),
                        'videoRgbRmsDifference': round(video_rms, 4)})
    start += slide['seconds']
contact.save(HERE / 'deck-contact-sheet.png')
video_contact.save(sample_dir / 'contact-sheet.png')
markdown = [ROOT / p for p in ['README.md', 'DEPLOYMENTS.md', 'CHANGELOG.md',
    'SECURITY.md', 'THREAT_MODEL.md', 'docs/SUBMISSION.md', 'docs/VIDEO_SCRIPT.md',
    'docs/pitch/README.md', 'docs/evidence/README.md']]
broken = []
local_links = 0
for p in markdown:
    for target in re.findall(r'\]\(([^)]+)\)', p.read_text()):
        if target.startswith(('http://', 'https://', '#', 'mailto:')):
            continue
        target_path = (p.parent / target.split('#', 1)[0]).resolve()
        local_links += 1
        if not target_path.exists() and target_path != OUTPUT:
            broken.append({'source': str(p.relative_to(ROOT)), 'target': target})
assert not broken, broken
text = (ROOT / 'docs/SUBMISSION.md').read_text()
for name in ['Prabal Pratap Singh', 'Nikhil Verma', 'Neha Singh']:
    assert name in text and any(name in s['body'] for s in slides)
for token in ['25 bps', '50 bps', '31611', '31612', '16408315', 'Unaudited']:
    assert token in text, token
assert 'solo' not in text.lower()
assert '\u2014' not in text, 'Submission editorial checklist prohibits em dashes.'
artifacts = [HERE / p for p in ['slides.json', 'generate.py', 'coil-wave2-deck.pdf',
    'coil-wave2-deck.pptx', 'coil-wave2-pitch.mp4', 'coil-wave2-pitch.srt']]
result = {
    'scope': 'Local materials only; no live chain, user, source verification or deployment proof.',
    'validatedAtUTC': datetime.now(timezone.utc).isoformat(),
    'command': 'python docs/pitch/validate.py',
    'status': 'pass', 'pdfPages': len(pdf), 'pptxSlides': len(slides),
    'authoredScenes': len(slides), 'authoredDurationSeconds': expected_duration,
    'ffprobe': probe, 'audio': 'none; intentionally text-guided with burned-in narrative',
    'pdfPagesRendered': 8, 'videoMidpointSamples': comparisons,
    'localMarkdownLinksChecked': local_links, 'brokenLocalMarkdownLinks': broken,
    'ledgerSchemaValid': True, 'fundedReleaseEvidenceReady': False,
    'pending': ['completion-release deployment and successful funded receipts',
                'full indexed source verification', '3-5 recruited consenting testers',
                'fresh public app/keeper release readback', 'separate mainnet go-live gates'],
    'sha256': {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
               for p in artifacts}
}
OUTPUT.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({k: result[k] for k in ['status','pdfPages','pptxSlides',
    'authoredDurationSeconds','localMarkdownLinksChecked','ledgerSchemaValid',
    'fundedReleaseEvidenceReady']}, indent=2))
print('Validation record:', OUTPUT.relative_to(ROOT))
