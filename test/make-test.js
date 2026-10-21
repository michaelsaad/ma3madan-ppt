// Builds test/test.pptx and test/test2.pptx with PowerPoint itself:
//   cscript //nologo //E:jscript test/make-test.js "<full path to the test folder>"
// test.pptx: 7 slides in 3 sections, notes, two click animations on slide 3, a "Go to 5" link and a
// "Last slide" button on slide 2, a web link on slide 4, and on slide 6 a link to test2.pptx.
var dir = WScript.Arguments(0);
var pp = new ActiveXObject("PowerPoint.Application");

function make(name, count, sections, extra) {
  var p = pp.Presentations.Add(0);
  for (var i = 1; i <= count; i++) {
    var s = p.Slides.Add(i, 2);
    s.Shapes.Item(1).TextFrame.TextRange.Text = (name == "test" ? "Slide " : "Other ") + i;
    s.Shapes.Item(2).TextFrame.TextRange.Text = "Body of slide " + i;
    s.NotesPage.Shapes.Placeholders.Item(2).TextFrame.TextRange.Text = "Notes for slide " + i;
  }
  if (extra) extra(p);
  for (var k = 0; k < sections.length; k++) p.SectionProperties.AddBeforeSlide(sections[k][1], sections[k][0]);
  p.SaveAs(dir + "\\" + name + ".pptx");
  p.Close();
}

make("test2", 3, [["Linked", 1]]);
make("test", 7, [["Opening", 1], ["Sermon", 4], ["Hymns", 7]], function (p) {
  var b = p.Slides.Item(2).Shapes.AddShape(1, 600, 380, 220, 90);
  b.TextFrame.TextRange.Text = "Go to 5";
  b.ActionSettings.Item(1).Action = 7;
  b.ActionSettings.Item(1).Hyperlink.SubAddress = p.Slides.Item(5).SlideID + ",5,Slide 5";
  var last = p.Slides.Item(2).Shapes.AddShape(1, 100, 380, 220, 90);
  last.TextFrame.TextRange.Text = "Last slide";
  last.ActionSettings.Item(1).Action = 4;
  var l = p.Slides.Item(4).Shapes.AddTextbox(1, 100, 420, 400, 50);
  l.TextFrame.TextRange.Text = "example.com";
  l.TextFrame.TextRange.ActionSettings.Item(1).Hyperlink.Address = "https://example.com/";
  var s3 = p.Slides.Item(3);
  s3.TimeLine.MainSequence.AddEffect(s3.Shapes.Item(2), 10, 0, 1);
  var t = s3.Shapes.AddTextbox(1, 100, 420, 300, 50); t.TextFrame.TextRange.Text = "appears 2nd";
  s3.TimeLine.MainSequence.AddEffect(t, 10, 0, 1);
  var o = p.Slides.Item(6).Shapes.AddShape(1, 600, 380, 220, 90);
  o.TextFrame.TextRange.Text = "Other deck";
  o.ActionSettings.Item(1).Action = 7;
  o.ActionSettings.Item(1).Hyperlink.Address = "test2.pptx";
});
WScript.Echo("ok");
