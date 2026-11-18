# Lets the tests import the bobcatch package when pytest runs from server/.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
