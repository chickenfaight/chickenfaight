import tempfile
import unittest
from pathlib import Path

from app.db.seed import read_topics


class TopicFileTests(unittest.TestCase):
    def read(self, text):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "topics.txt"
            path.write_text(text, encoding="utf-8")
            return read_topics(path)

    def test_comments_whitespace_and_unicode(self):
        self.assertEqual(
            self.read("  # comment\n\n Culture | Café culture | Support cafés | Oppose cafés \n"),
            [("Culture", "Café culture", "Support cafés", "Oppose cafés")],
        )

    def test_invalid_fields_report_line_number(self):
        for line in ["topic|pro|con", "category|topic|pro|con|extra", "|topic|pro|con", "category|topic||con", "x" * 256 + "|topic|pro|con"]:
            with self.subTest(line=line):
                with self.assertRaisesRegex(ValueError, r"topics.txt:2:"):
                    self.read("category|valid|pro|con\n" + line)

    def test_maximum_length_is_accepted(self):
        fields = ("c" * 255, "x" * 255, "y" * 255, "z" * 255)
        self.assertEqual(self.read("|".join(fields)), [fields])

    def test_example_file(self):
        path = Path(__file__).resolve().parents[1] / "topics.example.txt"
        self.assertEqual(len(read_topics(path)), 3)
