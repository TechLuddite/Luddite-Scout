import QtQuick
import qs.Commons

// Every line of text in the panel is one of these. Repository names, finding
// titles and file paths come from repositories nobody has vetted, so they are
// never interpreted as markup.
Text {
  textFormat: Text.PlainText
  wrapMode: Text.Wrap
  font.family: Style.font.family
  font.pixelSize: Style.font.body
}
