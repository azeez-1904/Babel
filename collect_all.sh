#!/usr/bin/env bash
# BabelSign full data collection script
# Run from the project root: bash collect_all.sh
#
# Each sign opens the webcam, shows a 3-second countdown, collects 50 samples,
# then pauses so you can reposition for the next sign.
# Press Q inside the window to skip a sign early.
# Resume any time — samples append to data/landmarks.csv.

set -e
cd "$(dirname "$0")"

SAMPLES=50

run_sign() {
    local SIGN=$1
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Next sign: $SIGN  ($SAMPLES samples)"
    echo "  Get your hand ready, then press ENTER to start..."
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    read -r
    python3 data_collection/collect_data.py --sign "$SIGN" --samples $SAMPLES
}

echo "================================================"
echo "  BabelSign Data Collection"
echo "  33 signs × $SAMPLES samples ≈ 55 minutes"
echo "  Tip: keep the camera at eye level, good lighting"
echo "  Tip: vary your hand distance slightly per sign"
echo "================================================"
echo ""
echo "Press ENTER to begin with the alphabet..."
read -r

# ── ASL Alphabet ─────────────────────────────────────────────────────────────
for LETTER in A B C D E F G H I J K L M N O P Q R S T U V W X Y Z; do
    run_sign "$LETTER"
done

# ── Control gestures ──────────────────────────────────────────────────────────
echo ""
echo "Alphabet complete! Now collecting control gestures..."
echo "(SPACE = flat open hand, DELETE = thumbs down)"
echo ""

run_sign "SPACE"
run_sign "DELETE"

# ── Common words ──────────────────────────────────────────────────────────────
echo ""
echo "Control gestures done! Now collecting common words..."
echo ""

run_sign "HELP"
run_sign "YES"
run_sign "NO"
run_sign "PLEASE"
run_sign "THANK_YOU"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "================================================"
echo "  Collection complete!"
echo "================================================"
echo ""
echo "Verify your data:"
echo "  python3 data_collection/verify_data.py"
echo ""
echo "Train the model:"
echo "  python3 model/train_classifier.py"
