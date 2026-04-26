#!/usr/bin/env bash
# BabelSign DEMO collection — 10 signs × 50 samples ≈ 15 minutes
# Enough to demo the full pipeline. Run collect_all.sh later for A-Z.
#
# ASL reference for each sign:
#   A  — fist, thumb resting on side
#   B  — flat hand, fingers together, thumb tucked
#   C  — curved hand like holding a ball
#   D  — index up, other fingers curved touching thumb
#   E  — fingers bent at knuckles, thumb tucked under
#   SPACE   — flat open hand, palm forward
#   DELETE  — thumbs down (or wave away)
#   HELP    — flat hand on fist, lift upward
#   YES     — fist nodding up and down (hold mid-nod)
#   NO      — index + middle tap against thumb (hold position)

set -e
cd "$(dirname "$0")"

SAMPLES=50

run() {
    local SIGN=$1
    local HINT=$2
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Sign:  $SIGN"
    echo "  Shape: $HINT"
    echo "  Press ENTER when ready..."
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    read -r
    python3 data_collection/collect_data.py --sign "$SIGN" --samples $SAMPLES
}

echo "================================================"
echo "  BabelSign Demo Data Collection (10 signs)"
echo "  ~15 minutes total"
echo "================================================"
read -r -p "Press ENTER to begin..."

run "A"      "Fist with thumb on side"
run "B"      "Flat hand, fingers together, thumb tucked"
run "C"      "Curved hand like holding a ball"
run "D"      "Index finger up, others curved touching thumb"
run "E"      "Fingers bent at knuckles, thumb tucked under"
run "SPACE"  "Flat open hand, palm forward"
run "DELETE" "Thumbs down"
run "HELP"   "Flat hand on fist, lift upward"
run "YES"    "Fist tilted forward (nod position)"
run "NO"     "Index + middle tap against thumb"

echo ""
echo "================================================"
echo "  Collection done! Running pipeline..."
echo "================================================"
echo ""
python3 data_collection/verify_data.py
echo ""
python3 model/train_classifier.py
echo ""
echo "================================================"
echo "  Everything ready. Testing live inference:"
echo "  python3 core/gesture_recognizer.py"
echo "================================================"
