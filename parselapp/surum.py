"""Uygulamanın sürümü.

Sürüm derlemesinde (GitHub Actions, .github/workflows/surum.yml) bu dosya etiketten yazılır: v0.2.0 -> "0.2.0".
Kaynaktan çalışırken sürüm yoktur ve güncelleme denetlenmez; denemek için PARSELSORGU_SURUM ortam
değişkeni verilebilir.
"""

import os

SURUM = os.environ.get("PARSELSORGU_SURUM") or None
