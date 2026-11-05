# Coil Labs Wave 2 deck and pitch source

Release-candidate materials, not public chain proof. The eight scenes are authored as a complete **112-second text-guided pitch**, 14 seconds each, rather than a truncated 171.76-second historical demo. There is no audio track; the guide panel is the narrative. All scenes persistently say **ILLUSTRATIVE WALKTHROUGH / RELEASE CANDIDATE / NOT CHAIN PROOF**. The historical receipt scene separately says **MATSNET 31611 / HISTORICAL BUILD ONLY**.

- `slides.json` is the editable content and timing source.
- `generate.py` is the reproducible layout/media source (Pillow, reportlab, python-pptx, ffmpeg).
- `coil-wave2-deck.pdf` and `coil-wave2-deck.pptx` contain eight matching rendered pages. PPTX speaker notes also contain the source text. Visual pages are embedded images; edit the JSON/renderer and regenerate to change the deck.
- `coil-wave2-pitch.mp4` is H.264, 1600×900, 24 fps and 112 seconds, with all guide text burned in. It plays without audio and without a subtitle-capable viewer.
- `coil-wave2-pitch.srt` is an optional matching guide transcript.
- `frames/01.png` through `08.png` are a complete visual storyboard.
- `deck-contact-sheet.png` aids page inspection. The validation artifact records PDF and PPTX page counts and ffprobe duration.

Regenerate from the repository root:

```bash
python docs/pitch/generate.py
```

The generator is local-only and needs no credentials or chain access. PDF and PPTX are generated from identical inspected frames. Timing/content comes from `slides.json`; the total duration is explicitly validated to stay at or below 120 seconds.

## Eight-scene source outline

1. BTC exposure and ownership: collateral, MUSD borrowing, guarded risk reduction.
2. Open: size/ratio preview, gross mint, accepted 25 bps default / 50 bps maximum fee, policy/depth checks.
3. Guard: owner funding/settings, reserve first, bounded fill and tip only after improvement.
4. Owner actions: safe repayment, recovered-surplus claim, protocol-permitted close; Recovery Mode limits.
5. Safety/operations: same oracle bound, paused start, finite caps, guardian/owner authority, public keeper freshness.
6. Historical matsnet receipts: October open/guard/close on an older factory, explicitly not completion proof.
7. Release gates: local/fork checks separated from actual funded matsnet evidence, recruited testers and gated mainnet.
8. Team and next step: Prabal Pratap Singh, Nikhil Verma, Neha Singh; tester recruitment and technical review.

Historical receipt links and chain/version caveats: [DEPLOYMENTS.md](../../DEPLOYMENTS.md). Current submission copy and pending external inputs: [SUBMISSION.md](../SUBMISSION.md). Script: [VIDEO_SCRIPT.md](../VIDEO_SCRIPT.md).

The separately labelled screenshots in `docs/evidence/screenshots` come from the legacy static redesign in `docs/media`. They can include placeholder transaction hashes and must never be used as receipt proof. The new pitch itself uses clearly illustrative diagrams rather than those screenshots.
