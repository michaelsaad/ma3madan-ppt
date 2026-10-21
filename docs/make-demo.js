// Builds docs/demo.pptx, the presentation in the README's screenshots, with PowerPoint itself:
//   cscript //nologo //E:jscript docs/make-demo.js "<full path to docs\demo.pptx>"
// Texts: Psalm 23 and Matthew 3 (King James Version, public domain).
var out = WScript.Arguments(0);
var pp = new ActiveXObject("PowerPoint.Application");
var p = pp.Presentations.Add(0);
p.PageSetup.SlideWidth = 960; p.PageSetup.SlideHeight = 540;

var NAVY = 0x341A0B, NAVY2 = 0x5A2E17, GOLD = 0x2EB8F5, WHITE = 0xFFFFFF, SOFT = 0xF0D9C9; // BGR
var slides = [];

function slide(title, body, notes, opts) {
  opts = opts || {};
  var s = p.Slides.Add(p.Slides.Count + 1, 12); // ppLayoutBlank
  s.FollowMasterBackground = 0;
  s.Background.Fill.TwoColorGradient(1, 1);
  s.Background.Fill.ForeColor.RGB = opts.dark ? 0x1C0E06 : NAVY;
  s.Background.Fill.BackColor.RGB = NAVY2;
  // a thin gold line, like the app
  var line = s.Shapes.AddShape(1, 70, opts.center ? 300 : 128, opts.center ? 820 : 120, 4);
  line.Fill.ForeColor.RGB = GOLD; line.Line.Visible = 0;
  if (opts.center) line.Left = 420;
  var t = s.Shapes.AddTextbox(1, 70, opts.center ? 170 : 50, 820, 80);
  t.Name = "Title";
  var tr = t.TextFrame.TextRange;
  tr.Text = title; tr.Font.Name = "Segoe UI Semibold"; tr.Font.Size = opts.center ? 54 : 38; tr.Font.Color.RGB = WHITE;
  if (opts.center) tr.ParagraphFormat.Alignment = 2;
  if (body) {
    var b = s.Shapes.AddTextbox(1, 70, opts.center ? 320 : 160, 820, 320);
    b.Name = "Body";
    var br = b.TextFrame.TextRange;
    br.Text = body; br.Font.Name = "Segoe UI"; br.Font.Size = opts.center ? 24 : 28; br.Font.Color.RGB = SOFT;
    br.ParagraphFormat.SpaceAfter = 10;
    if (opts.center) br.ParagraphFormat.Alignment = 2;
    if (opts.animate) {
      // each paragraph comes in on a click
      s.TimeLine.MainSequence.AddEffect(b, 10, 2, 1); // fade in, one paragraph per click
    }
  }
  if (notes) s.NotesPage.Shapes.Placeholders.Item(2).TextFrame.TextRange.Text = notes;
  slides.push(s);
  return s;
}

slide("Sunday Service", "Welcome! We're glad you are here.", "Welcome everyone. Phones on silent, please.\nAnnouncements are at the end.", { center: true, dark: true });
slide("Opening prayer", "Let us stand and pray together.", "Invite the congregation to stand.", { center: true });

slide("Psalm 23  \u00b7  1\u20132", "The LORD is my shepherd; I shall not want.\nHe maketh me to lie down in green pastures: he leadeth me beside the still waters.", "Read slowly. Pause after each verse.");
slide("Psalm 23  \u00b7  3\u20134", "He restoreth my soul: he leadeth me in the paths of righteousness for his name's sake.\nYea, though I walk through the valley of the shadow of death, I will fear no evil: for thou art with me; thy rod and thy staff they comfort me.", "");
slide("Psalm 23  \u00b7  5\u20136", "Thou preparest a table before me in the presence of mine enemies: thou anointest my head with oil; my cup runneth over.\nSurely goodness and mercy shall follow me all the days of my life: and I will dwell in the house of the LORD for ever.", "Everyone reads the last verse together.");

var s6 = slide("The Baptism of the Lord", "Matthew 3:13\u201317", "Today's reading: Matthew chapter 3.\nAsk who remembers where the Jordan river is.", { center: true });
slide("In the Jordan", "Then cometh Jesus from Galilee to Jordan unto John, to be baptized of him.\nBut John forbad him, saying, I have need to be baptized of thee, and comest thou to me?", "Verses 13\u201314. John's humility.", { animate: true });
slide("The heavens were opened", "And Jesus, when he was baptized, went up straightway out of the water: and, lo, the heavens were opened unto him, and he saw the Spirit of God descending like a dove, and lighting upon him.", "Verse 16. The dove: the Holy Spirit.");
var s9 = slide("This is my beloved Son", "And lo a voice from heaven, saying, This is my beloved Son, in whom I am well pleased.", "Verse 17. The Theophany: Father, Son and Holy Spirit together.");
// a button back to the start of the reading
var btn = s9.Shapes.AddShape(5, 70, 430, 260, 56); // rounded rectangle
btn.Fill.ForeColor.RGB = GOLD; btn.Line.Visible = 0;
btn.TextFrame.TextRange.Text = "Back to the reading";
btn.TextFrame.TextRange.Font.Name = "Segoe UI Semibold"; btn.TextFrame.TextRange.Font.Size = 18; btn.TextFrame.TextRange.Font.Color.RGB = NAVY;
btn.ActionSettings.Item(1).Action = 7;
btn.ActionSettings.Item(1).Hyperlink.SubAddress = s6.SlideID + "," + s6.SlideIndex + ",The Baptism of the Lord";

slide("Announcements", "Bible study: Wednesday 7 pm\nYouth meeting: Friday 6 pm\nVisit us online", "Mention the new youth meeting time.");
slide("Thank you", "Go in peace.", "", { center: true, dark: true });

p.SectionProperties.AddBeforeSlide(1, "Welcome");
p.SectionProperties.AddBeforeSlide(3, "Psalm 23");
p.SectionProperties.AddBeforeSlide(6, "Reading");
p.SectionProperties.AddBeforeSlide(10, "Announcements");
p.SaveAs(out);
p.Close();
WScript.Echo("ok");
