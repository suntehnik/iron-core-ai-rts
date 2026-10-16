import AppKit
import CoreGraphics

// Iron Core app icon: the teal robot commander with a glowing orange core, on battlefield sand.
// Regenerate: swiftc -O -o /tmp/render-icon ios/tools/render-app-icon.swift && /tmp/render-icon ios/IronCore/Assets.xcassets/AppIcon.appiconset/AppIcon.png
let size = 1024
let cs = CGColorSpace(name: CGColorSpace.sRGB)!
let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: cs,
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
// flip to a top-left origin, like the SVG portraits
ctx.translateBy(x: 0, y: CGFloat(size)); ctx.scaleBy(x: 1, y: -1)

func hex(_ s: String, _ a: CGFloat = 1) -> CGColor {
  let v = UInt32(s.dropFirst(), radix: 16)!
  return CGColor(srgbRed: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255, blue: CGFloat(v & 255) / 255, alpha: a)
}
let ink = hex("#1f2a33")

// Background: warm sand with a soft light from the top left
let bg = CGGradient(colorsSpace: cs, colors: [hex("#f7e3b0"), hex("#e2bf7c"), hex("#c99a55")] as CFArray, locations: [0, 0.55, 1])!
ctx.drawLinearGradient(bg, start: CGPoint(x: 0, y: 0), end: CGPoint(x: 1024, y: 1024), options: [])
// ground shadow under the head
ctx.setFillColor(hex("#8a6a3a", 0.35))
ctx.fillEllipse(in: CGRect(x: 200, y: 830, width: 624, height: 110))

func rounded(_ r: CGRect, _ radius: CGFloat) -> CGPath { CGPath(roundedRect: r, cornerWidth: radius, cornerHeight: radius, transform: nil) }
func fillStroke(_ path: CGPath, _ fill: CGColor, line: CGFloat = 26) {
  ctx.addPath(path); ctx.setFillColor(fill); ctx.fillPath()
  ctx.addPath(path); ctx.setStrokeColor(ink); ctx.setLineWidth(line); ctx.setLineJoin(.round); ctx.strokePath()
}

// Antenna with the amber bulb
ctx.setStrokeColor(ink); ctx.setLineWidth(30); ctx.setLineCap(.round)
ctx.move(to: CGPoint(x: 512, y: 300)); ctx.addLine(to: CGPoint(x: 512, y: 168)); ctx.strokePath()
fillStroke(CGPath(ellipseIn: CGRect(x: 462, y: 104, width: 100, height: 100), transform: nil), hex("#f2b134"), line: 22)

// Side bolts (orange, the enemy's colour as an accent)
for x in [168.0, 768.0] { fillStroke(rounded(CGRect(x: x, y: 470, width: 88, height: 170), 34), hex("#f97316"), line: 22) }

// Head
let head = rounded(CGRect(x: 216, y: 296, width: 592, height: 520), 120)
ctx.saveGState(); ctx.addPath(head); ctx.clip()
let face = CGGradient(colorsSpace: cs, colors: [hex("#2dd4bf"), hex("#14b8a6"), hex("#0f8f84")] as CFArray, locations: [0, 0.5, 1])!
ctx.drawLinearGradient(face, start: CGPoint(x: 300, y: 300), end: CGPoint(x: 720, y: 816), options: [])
// highlight band
ctx.setFillColor(hex("#ffffff", 0.18)); ctx.fill(CGRect(x: 216, y: 296, width: 592, height: 70))
ctx.restoreGState()
ctx.addPath(head); ctx.setStrokeColor(ink); ctx.setLineWidth(30); ctx.strokePath()

// Visor and glowing eyes
fillStroke(rounded(CGRect(x: 286, y: 410, width: 452, height: 190), 70), hex("#13202a"), line: 20)
for cx in [404.0, 620.0] {
  ctx.saveGState()
  ctx.setShadow(offset: .zero, blur: 46, color: hex("#7ef0ff", 0.95))
  ctx.setFillColor(hex("#7ef0ff")); ctx.fillEllipse(in: CGRect(x: cx - 54, y: 451, width: 108, height: 108))
  ctx.restoreGState()
  ctx.setFillColor(hex("#e9fdff")); ctx.fillEllipse(in: CGRect(x: cx - 16, y: 475, width: 36, height: 36))
}

// The iron core: a glowing reactor on the chin
let corePath = CGPath(ellipseIn: CGRect(x: 432, y: 636, width: 160, height: 160), transform: nil)
ctx.saveGState()
ctx.setShadow(offset: .zero, blur: 60, color: hex("#ff8a2a", 0.9))
ctx.addPath(corePath); ctx.setFillColor(hex("#f97316")); ctx.fillPath()
ctx.restoreGState()
ctx.saveGState(); ctx.addPath(corePath); ctx.clip()
let core = CGGradient(colorsSpace: cs, colors: [hex("#fff1c2"), hex("#ffb547"), hex("#f97316"), hex("#c2410c")] as CFArray, locations: [0, 0.3, 0.7, 1])!
ctx.drawRadialGradient(core, startCenter: CGPoint(x: 498, y: 700), startRadius: 0, endCenter: CGPoint(x: 512, y: 716), endRadius: 90, options: [])
ctx.restoreGState()
ctx.addPath(corePath); ctx.setStrokeColor(ink); ctx.setLineWidth(22); ctx.strokePath()
// core ring segments
ctx.setStrokeColor(hex("#1f2a33", 0.55)); ctx.setLineWidth(10)
for a in stride(from: 0.0, to: 360.0, by: 60.0) {
  let r = a * .pi / 180
  ctx.move(to: CGPoint(x: 512 + cos(r) * 48, y: 716 + sin(r) * 48)); ctx.addLine(to: CGPoint(x: 512 + cos(r) * 70, y: 716 + sin(r) * 70)); ctx.strokePath()
}

let image = ctx.makeImage()!
let rep = NSBitmapImageRep(cgImage: image)
let out = CommandLine.arguments[1]
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
print("wrote", out)
