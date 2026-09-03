/* =========================================================
   I7SEVEN MOBILE — PDF invoice

   Draws the invoice directly with PDFKit. No headless browser,
   so it runs on the counter machine and on Vercel alike.
   Output is a real PDF with selectable text.
   ========================================================= */
"use strict";

const path = require("node:path");
const fs = require("node:fs");

/* -----------------------------------------------------------------
   PDFKit loads its font metrics lazily from separate .cjs files. A
   bundler that does not follow those lazy requires leaves them out of
   the deployment, and the first PDF fails with

     Cannot find module .../standard-fonts/Helvetica.cjs

   A copy of those files lives in lib/pdfkit-fonts, which is part of
   this repository and so is always deployed. Before PDFKit loads, each
   one is placed into Node's module cache under the path PDFKit will ask
   for, so its own require finds it without touching the filesystem.
   When the real files are present, nothing here happens.

   PDFKit's standalone build would also fix the fonts, but it is the
   browser build: it cannot decode PNGs in Node, which loses the logo.
----------------------------------------------------------------- */
const Module = require("node:module");

/* -----------------------------------------------------------------
   PDFKit asks for its font metrics with a package-internal import,
   "#standard-fonts/Helvetica", resolved lazily the first time text is
   drawn. Bundlers that only follow visible requires leave those files
   out of a deployment, and the first PDF then fails with

     Cannot find module .../standard-fonts/Helvetica.cjs
     Invalid standard font data

   The metrics for the eight faces this invoice uses are embedded below,
   about 33 KB, so nothing has to be loaded from disk. Normal resolution
   is tried first and left untouched; this only steps in when it fails.
----------------------------------------------------------------- */
const EMBEDDED_FONTS = {"Helvetica":{"name":"Helvetica","bbox":[-166,-225,1000,931],"ascender":718,"descender":-207,"xHeight":523,"capHeight":718,"glyphNames":"space exclam quotedbl numbersign dollar percent ampersand quotesingle parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight nine colon semicolon less equal greater question at A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore grave a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde Euro quotesinglbase florin quotedblbase ellipsis dagger daggerdbl circumflex perthousand Scaron guilsinglleft OE Zcaron quoteleft quoteright quotedblleft quotedblright bullet endash emdash tilde trademark scaron guilsinglright oe zcaron ydieresis exclamdown cent sterling currency yen brokenbar section dieresis copyright ordfeminine guillemotleft logicalnot registered macron degree plusminus twosuperior threesuperior acute mu paragraph periodcentered cedilla onesuperior ordmasculine guillemotright onequarter onehalf threequarters questiondown Agrave Aacute Acircumflex Atilde Adieresis Aring AE Ccedilla Egrave Eacute Ecircumflex Edieresis Igrave Iacute Icircumflex Idieresis Eth Ntilde Ograve Oacute Ocircumflex Otilde Odieresis multiply Oslash Ugrave Uacute Ucircumflex Udieresis Yacute Thorn germandbls agrave aacute acircumflex atilde adieresis aring ae ccedilla egrave eacute ecircumflex edieresis igrave iacute icircumflex idieresis eth ntilde ograve oacute ocircumflex otilde odieresis divide oslash ugrave uacute ucircumflex udieresis yacute thorn","glyphWidths":[278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,556,222,556,333,1000,556,556,333,1000,667,333,1000,611,222,222,333,333,350,556,1000,333,1000,500,333,944,500,500,333,556,556,556,556,260,556,333,737,370,556,584,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556],"kernPairs":[-180,[10332,2],-160,[9569],-150,[8182,2],-140,[9517,54,70,1552,1074,1,1,51,4,10,105,1,1,1,1,1,3,1,1,1,7,1,1,1,1,2,26464,1,1,51,4,10,105,1,1,2,1,3,1,1,1,7,1,1,1,1,2],-125,[11622,2],-120,[7147,3206,119,1,1,1,1,1,715,2,19,32,4,10,3,3,2,2,63,1,1,1,1,1,27,1,1,2,1,4,1,1,7,1,1,2,2,1,1,1,1,1,21339,215,215,215,215,215],-110,[9512,2,2774,52,67,1,1,1,1,1,52,1,1,1,26481,52,67,1,1,1,1,1,52,1,1,1],-100,[2689,2,428,2,4031,124,11871,2,6878,2,6708,124,91,124,91,124,91,124,91,124,91,124,11871,2],-95,[44732,2],-90,[57,124,7616,124],-85,[12302,123,1,1,1,1,2,26531,123,1,1,1,1,2,5717],-80,[8203,119,1,1,1,1,1,3296,20,36,10,73,1,1,1,1,1,35,1,1,1,7,1,1,1,1,2,19,2,6663,2],-70,[7149,603,2,40,1721,647,124,1389,20,99,1,1,1,1,1,20,1,1,1,11613,9299,215,215,215,215,215,2798,124,91,124,91,124,91,124,91,124,306,124,1081,5704,1,2,32,92],-60,[108,2902,7151,1140,66,5,13,896,1,6435,2,17887,215,215,215,215,430,1045,1],-57,[23328,216],-55,[44785,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,5,27,3,64,1,1,1,1,1,2,1,1,1,1,1,1,1,1,2,1,1,1,1,1,2,1,1,1,1],-50,[52,2,5536,215,1343,2,122,1,1,1,960,119,1,1,1,1,1,933,42,32,49,1,1,1,1,2,37,701,230,10,113,1,1,1,7,1,1,1,1,2,276,3,124,927,119,1,1,1,1,1,5660,2,5859,14,1,34,9181,2,122,1,1,1,88,2,122,1,1,1,88,2,122,1,1,1,88,2,122,1,1,1,88,2,122,1,1,1,88,2,122,1,1,1,2669,215,215,215,215,430],-45,[8252],-40,[55,7126,1,2,32,92,465,22,97,1,1,1,1,1,1417,10,113,1,1,1,7,1,1,1,1,2,664,2,38,228,119,1,1,1,1,1,294,124,1,1,1,297,123,1,1,1,1,2,51,2,19,119,1,1,1,1,1,84,1,12,8,123,1,1,1,1,2,52,52,119,1,1,1,1,1,2188,2,2793,2,6866,8901,1,2,32,92,88,1,2,32,92,88,1,2,32,92,88,1,2,32,92,88,1,2,32,92,88,1,2,32,92,2594,2,38,175,2,38,175,2,38,175,2,38,175,2,38,390,2,38,175,2,19,119,1,1,1,1,1,70,2,19,119,1,1,1,1,1,70,2,19,119,1,1,1,1,1,70,2,19,119,1,1,1,1,1,4585,2,213,2,213,2,213,2,213,2],-35,[17212,2],-30,[110,7020,4,8,2,36,74,11,1,1,1,1,2,33,1,1,1,230,2,700,10,113,1,1,1,7,1,1,1,1,2,664,2,286,124,1,1,1,92,32,92,487,642,3,1089,10,6,107,1,1,1,7,1,1,1,1,2,1,1,1,1,2027,32,92,733,2,139,2,51,4,10,105,1,1,1,1,1,3,1,1,1,7,1,1,1,1,2,311,32,92,1380,1,32,92,91,32,92,519,1057,123,1,1,1,6127,7473,4,8,2,36,74,11,1,1,1,1,2,33,1,1,1,38,4,8,2,36,74,11,1,1,1,1,2,33,1,1,1,38,4,8,2,36,74,11,1,1,1,1,2,33,1,1,1,38,4,8,2,36,74,11,1,1,1,1,2,33,1,1,1,38,4,8,2,36,74,11,1,1,1,1,2,33,1,1,1,38,4,8,2,36,74,11,1,1,1,1,2,33,1,1,1,230,2,2406,215,215,215,215,430,1754,32,92,91,32,92,91,32,92,91,32,92,91,32,92,91,32,92,518,2,213,2,213,2,213,2,1505,1,32,92,90,1,32,92,90,1,32,92,90,1,32,92,90,1,32,92],-25,[18555,4,10,105,1,1,1,1,1,3,1,1,1,7,1,1,1,1,2],-20,[7322,2,1739,32,20,67,1,1,1,1,1,27,1,1,1,1,1,20,1,1,1,896,119,1,1,1,1,1,535,123,1,1,1,1,2,51,2,227,1,665,42,32,49,1,1,1,1,2,37,290,124,1609,1,204,9,1,3,32,88,1,1,1,1,77,442,2,32,92,1146,10,113,1,1,1,7,1,1,1,1,2,523,2344,4,10,105,1,1,1,1,1,3,1,1,1,7,1,1,1,1,2,3029,2,3706,4,10,105,1,1,1,1,1,3,1,1,1,7,1,1,1,1,2,10360,119,1,1,1,1,1,91,119,1,1,1,1,1,91,119,1,1,1,1,1,91,119,1,1,1,1,1,91,119,1,1,1,1,1,306,119,1,1,1,1,1,991,124,534,1,214,1,214,1,214,1,214,1,214,1,418,227,2,32,92,89,2,32,92,89,2,32,92,89,2,32,92,1163,2559,4,10,105,1,1,1,1,1,3,1,1,1,7,1,1,1,1,2],-15,[14417,430,2,1795,32,92,91,32,92,88,1,785,2,911,119,1,1,1,1,1,525,10,113,1,1,1,7,1,1,1,1,2,5609,2,700,10,113,1,1,1,7,1,1,1,1,2,15069,215,2,213,2,213,2,213,2,1365,32,92,88,1,214,1,214,1,214,1,214,1],-10,[7363,124,1,1,1,3098,124,1,1,1,3541,1091,1293,124,1,1,1,88,124,1,1,1,713,119,1,1,1,1,1,955,10,113,1,1,1,7,1,1,1,1,2,24387,124,1,1,1],15,[17703,2,1,9,111,1,1,1,10,1,1,1],25,[17707,1,123],30,[17656,1,53,6,3,32,92],40,[17714],50,[15159],60,[15161]]},"HelveticaBold":{"name":"Helvetica-Bold","bbox":[-170,-228,1003,962],"ascender":718,"descender":-207,"xHeight":532,"capHeight":718,"glyphNames":"space exclam quotedbl numbersign dollar percent ampersand quotesingle parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight nine colon semicolon less equal greater question at A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore grave a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde Euro quotesinglbase florin quotedblbase ellipsis dagger daggerdbl circumflex perthousand Scaron guilsinglleft OE Zcaron quoteleft quoteright quotedblleft quotedblright bullet endash emdash tilde trademark scaron guilsinglright oe zcaron ydieresis exclamdown cent sterling currency yen brokenbar section dieresis copyright ordfeminine guillemotleft logicalnot registered macron degree plusminus twosuperior threesuperior acute mu paragraph periodcentered cedilla onesuperior ordmasculine guillemotright onequarter onehalf threequarters questiondown Agrave Aacute Acircumflex Atilde Adieresis Aring AE Ccedilla Egrave Eacute Ecircumflex Edieresis Igrave Iacute Icircumflex Idieresis Eth Ntilde Ograve Oacute Ocircumflex Otilde Odieresis multiply Oslash Ugrave Uacute Ucircumflex Udieresis Yacute Thorn germandbls agrave aacute acircumflex atilde adieresis aring ae ccedilla egrave eacute ecircumflex edieresis igrave iacute icircumflex idieresis eth ntilde ograve oacute ocircumflex otilde odieresis divide oslash ugrave uacute ucircumflex udieresis yacute thorn","glyphWidths":[278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,556,278,556,500,1000,556,556,333,1000,667,333,1000,611,278,278,500,500,350,556,1000,333,1000,556,333,944,500,556,333,556,556,556,556,280,556,333,737,370,556,584,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611],"kernPairs":[-140,[9569,2],-120,[57,124,2508,2,428,2,6396,124,691,2,859,429,2],-110,[7152,124,2238,2774,119,1,1,1,1,1,20325,124,91,124,91,124,91,124,91,124,91,124,5012,119,1,1,1,1,1],-100,[52,8130,2,2169,119,1,1,1,1,1,1790,2,65,6,117,1,1,1,1,2,1,1,1,1,26460,2,65,6,117,1,1,1,1,2,1,1,1,1],-90,[7147,2365,1701,52,67,1,1,1,1,1,52,1,1,1,297,123,1,1,1,1,2,502,119,1,1,1,1,1,20288,215,215,215,215,215,5173,119,1,1,1,1,1],-80,[54,1,55,7039,1054,119,1,1,1,1,1,1188,1677,2,51,14,3,102,1,1,1,1,1,13,1,1,1,1,2,235,20,119,1,1,1,1,1,70,2,485,123,1,1,1,6052,2,643,2,4286,68,362,2162,2,6705,215,215,215,215,215,5175,123,1,1,1,6697,2],-70,[7797,124,2241,124,2016,123,1,1,1,1,2,24176,124,91,124,91,124,91,124,91,124,306,124,941,123,1,1,1,1,2],-60,[108,7042,4099,18,2,32,71,1,1,1,18,282,20,99,1,1,1,1,1,20,1,1,1,36,46,73,1,1,1,1,1,45,1,1,1,1,2,5609,2,5874,34,9183,215,215,215,215,215],-50,[7134,14,124,1,1,1,2863,21,1,1,96,1,1,1,1,1,542,3,124,497,119,1,1,1,1,1,97,8,22,101,1,1,1,1,2,16,1,1,1,476,1,20437,14,124,1,1,1,74,14,124,1,1,1,74,14,124,1,1,1,74,14,124,1,1,1,74,14,124,1,1,1,74,14,124,1,1,1,2648,21,1,1,96,1,1,1,1,1,91,21,1,1,96,1,1,1,1,1,91,21,1,1,96,1,1,1,1,1,91,21,1,1,96,1,1,1,1,1,91,21,1,1,96,1,1,1,1,1,306,21,1,1,96,1,1,1,1,1,91,119,1,1,1,1,1,91,119,1,1,1,1,1,91,119,1,1,1,1,1,91,119,1,1,1,1,1,84,1],-46,[23328,216],-45,[11910,124,1,1,1],-40,[2580,430,2580,215,1325,12,2,37,73,11,1,1,1,1,2,502,21,1,97,1,1,1,1,1,1437,32,92,659,2,38,242,123,1,1,1,1,2,277,401,1,20,123,1,1,1,1,2,280,1,201,52,119,1,1,1,1,1,4842,1861,2,4798,9198,12,2,37,73,11,1,1,1,1,2,74,12,2,37,73,11,1,1,1,1,2,74,12,2,37,73,11,1,1,1,1,2,74,12,2,37,73,11,1,1,1,1,2,74,12,2,37,73,11,1,1,1,1,2,74,12,2,37,73,11,1,1,1,1,2,2631,2,38,175,2,38,175,2,38,175,2,38,175,2,38,390,2,38,5409],-35,[9324,123,1,1,1,1,2,2441,123,1,1,1],-30,[7180,2,2,32,88,1,1,1,1,35,119,1,1,1,1,1,285,2,1538,38,85,1,1,1,1,2,33,1,1,1,92,32,92,712,4,115,1,1,1,1,1,3,1,1,1,892,2,5235,32,92,305,1496,123,1,1,1,1,2,502,119,1,1,1,1,1,6756,119,1,1,1,1,1,6561,2,2,32,88,1,1,1,1,87,2,2,32,88,1,1,1,1,87,2,2,32,88,1,1,1,1,87,2,2,32,88,1,1,1,1,87,2,2,32,88,1,1,1,1,87,2,2,32,88,1,1,1,1,4099,2,213,2,213,2,213,2,4804,215,215,215,215,430,1052,119,1,1,1,1,1],-25,[19214,123,1,1,1,1,2,6751,123,1,1,1,1,2,19651,123,1,1,1,1,2],-20,[8235,119,1,1,1,1,1,683,2,19,52,67,1,1,1,1,1,52,1,1,1,1555,5,1,117,1,1,1,1,2,1,1,1,1,942,42,32,49,1,1,1,1,2,37,2026,32,92,87,1,3,32,88,1,1,1,1,77,1,648,123,1,1,1,1,2,311,32,92,947,124,1,1,1,92,32,92,88,3,32,92,445,54,1,11,2,110,11,1,1,1,1,2,717,119,1,1,1,1,1,105,123,1,1,1,1,2,4598,10,16128,32,92,91,32,92,91,32,92,91,32,92,91,32,92,91,32,92,292,1,2163,32,92,88,3,32,92,88,3,32,92,88,3,32,92,88,3,32,92,88,3,32,92,303,3,32,92],-15,[9314,123,1,1,1,4621,1,644,1,2,32,92,88,1,1,1,32,92,1156,123,1,1,1,1,2,94,2,32,92,519,217,32,92,288,12,34,185,7310,14404,1,214,1,214,1,214,1,214,1,214,1,644,1,1,1,32,92,88,1,1,1,32,92,88,1,1,1,32,92,88,1,1,1,32,92,1379,215,215,215,215,430],-10,[7363,124,1,1,1,3098,124,1,1,1,1136,1,2194,220,211,17,32,92,70,374,2,55,123,1,1,1,91,1519,124,1,1,1,2007,123,1,1,1,89,123,1,1,1,6754,123,1,1,1,13421,215,215,215,215,215,431,17,32,92,2022,124,1,1,1,2437,123,1,1,1],10,[14847,487,123,1,1,1,2256,3,32,92,1576,123,1,1,1,6324,123,1,1,1,15297,215,215,215],20,[10547,2,4300,2865,23580,215,215,215],30,[15159,2]]},"HelveticaBoldOblique":{"name":"Helvetica-BoldOblique","bbox":[-174,-228,1114,962],"ascender":718,"descender":-207,"xHeight":532,"capHeight":718,"glyphNames":"space exclam quotedbl numbersign dollar percent ampersand quotesingle parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight nine colon semicolon less equal greater question at A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore grave a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde Euro quotesinglbase florin quotedblbase ellipsis dagger daggerdbl circumflex perthousand Scaron guilsinglleft OE Zcaron quoteleft quoteright quotedblleft quotedblright bullet endash emdash tilde trademark scaron guilsinglright oe zcaron ydieresis exclamdown cent sterling currency yen brokenbar section dieresis copyright ordfeminine guillemotleft logicalnot registered macron degree plusminus twosuperior threesuperior acute mu paragraph periodcentered cedilla onesuperior ordmasculine guillemotright onequarter onehalf threequarters questiondown Agrave Aacute Acircumflex Atilde Adieresis Aring AE Ccedilla Egrave Eacute Ecircumflex Edieresis Igrave Iacute Icircumflex Idieresis Eth Ntilde Ograve Oacute Ocircumflex Otilde Odieresis multiply Oslash Ugrave Uacute Ucircumflex Udieresis Yacute Thorn germandbls agrave aacute acircumflex atilde adieresis aring ae ccedilla egrave eacute ecircumflex edieresis igrave iacute icircumflex idieresis eth ntilde ograve oacute ocircumflex otilde odieresis divide oslash ugrave uacute ucircumflex udieresis yacute thorn","glyphWidths":[278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,556,278,556,500,1000,556,556,333,1000,667,333,1000,611,278,278,500,500,350,556,1000,333,1000,556,333,944,500,556,333,556,556,556,556,280,556,333,737,370,556,584,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611],"kernPairs":[-140,[9569,2],-120,[57,124,2508,2,428,2,6396,124,691,2,859,429,2],-110,[7152,124,2238,2774,119,1,1,1,1,1,20325,124,91,124,91,124,91,124,91,124,91,124,5012,119,1,1,1,1,1],-100,[52,8130,2,2169,119,1,1,1,1,1,1790,2,65,6,117,1,1,1,1,2,1,1,1,1,26460,2,65,6,117,1,1,1,1,2,1,1,1,1],-90,[7147,2365,1701,52,67,1,1,1,1,1,52,1,1,1,297,123,1,1,1,1,2,502,119,1,1,1,1,1,20288,215,215,215,215,215,5173,119,1,1,1,1,1],-80,[54,1,55,7039,1054,119,1,1,1,1,1,1188,1677,2,51,14,3,102,1,1,1,1,1,13,1,1,1,1,2,235,20,119,1,1,1,1,1,70,2,485,123,1,1,1,6052,2,643,2,4286,68,362,2162,2,6705,215,215,215,215,215,5175,123,1,1,1,6697,2],-70,[7797,124,2241,124,2016,123,1,1,1,1,2,24176,124,91,124,91,124,91,124,91,124,306,124,941,123,1,1,1,1,2],-60,[108,7042,4099,18,2,32,71,1,1,1,18,282,20,99,1,1,1,1,1,20,1,1,1,36,46,73,1,1,1,1,1,45,1,1,1,1,2,5609,2,5874,34,9183,215,215,215,215,215],-50,[7134,14,124,1,1,1,2863,21,1,1,96,1,1,1,1,1,542,3,124,497,119,1,1,1,1,1,97,8,22,101,1,1,1,1,2,16,1,1,1,476,1,20437,14,124,1,1,1,74,14,124,1,1,1,74,14,124,1,1,1,74,14,124,1,1,1,74,14,124,1,1,1,74,14,124,1,1,1,2648,21,1,1,96,1,1,1,1,1,91,21,1,1,96,1,1,1,1,1,91,21,1,1,96,1,1,1,1,1,91,21,1,1,96,1,1,1,1,1,91,21,1,1,96,1,1,1,1,1,306,21,1,1,96,1,1,1,1,1,91,119,1,1,1,1,1,91,119,1,1,1,1,1,91,119,1,1,1,1,1,91,119,1,1,1,1,1,84,1],-46,[23328,216],-45,[11910,124,1,1,1],-40,[2580,430,2580,215,1325,12,2,37,73,11,1,1,1,1,2,502,21,1,97,1,1,1,1,1,1437,32,92,659,2,38,242,123,1,1,1,1,2,277,401,1,20,123,1,1,1,1,2,280,1,201,52,119,1,1,1,1,1,4842,1861,2,4798,9198,12,2,37,73,11,1,1,1,1,2,74,12,2,37,73,11,1,1,1,1,2,74,12,2,37,73,11,1,1,1,1,2,74,12,2,37,73,11,1,1,1,1,2,74,12,2,37,73,11,1,1,1,1,2,74,12,2,37,73,11,1,1,1,1,2,2631,2,38,175,2,38,175,2,38,175,2,38,175,2,38,390,2,38,5409],-35,[9324,123,1,1,1,1,2,2441,123,1,1,1],-30,[7180,2,2,32,88,1,1,1,1,35,119,1,1,1,1,1,285,2,1538,38,85,1,1,1,1,2,33,1,1,1,92,32,92,712,4,115,1,1,1,1,1,3,1,1,1,892,2,5235,32,92,305,1496,123,1,1,1,1,2,502,119,1,1,1,1,1,6756,119,1,1,1,1,1,6561,2,2,32,88,1,1,1,1,87,2,2,32,88,1,1,1,1,87,2,2,32,88,1,1,1,1,87,2,2,32,88,1,1,1,1,87,2,2,32,88,1,1,1,1,87,2,2,32,88,1,1,1,1,4099,2,213,2,213,2,213,2,4804,215,215,215,215,430,1052,119,1,1,1,1,1],-25,[19214,123,1,1,1,1,2,6751,123,1,1,1,1,2,19651,123,1,1,1,1,2],-20,[8235,119,1,1,1,1,1,683,2,19,52,67,1,1,1,1,1,52,1,1,1,1555,5,1,117,1,1,1,1,2,1,1,1,1,942,42,32,49,1,1,1,1,2,37,2026,32,92,87,1,3,32,88,1,1,1,1,77,1,648,123,1,1,1,1,2,311,32,92,947,124,1,1,1,92,32,92,88,3,32,92,445,54,1,11,2,110,11,1,1,1,1,2,717,119,1,1,1,1,1,105,123,1,1,1,1,2,4598,10,16128,32,92,91,32,92,91,32,92,91,32,92,91,32,92,91,32,92,292,1,2163,32,92,88,3,32,92,88,3,32,92,88,3,32,92,88,3,32,92,88,3,32,92,303,3,32,92],-15,[9314,123,1,1,1,4621,1,644,1,2,32,92,88,1,1,1,32,92,1156,123,1,1,1,1,2,94,2,32,92,519,217,32,92,288,12,34,185,7310,14404,1,214,1,214,1,214,1,214,1,214,1,644,1,1,1,32,92,88,1,1,1,32,92,88,1,1,1,32,92,88,1,1,1,32,92,1379,215,215,215,215,430],-10,[7363,124,1,1,1,3098,124,1,1,1,1136,1,2194,220,211,17,32,92,70,374,2,55,123,1,1,1,91,1519,124,1,1,1,2007,123,1,1,1,89,123,1,1,1,6754,123,1,1,1,13421,215,215,215,215,215,431,17,32,92,2022,124,1,1,1,2437,123,1,1,1],10,[14847,487,123,1,1,1,2256,3,32,92,1576,123,1,1,1,6324,123,1,1,1,15297,215,215,215],20,[10547,2,4300,2865,23580,215,215,215],30,[15159,2]]},"HelveticaOblique":{"name":"Helvetica-Oblique","bbox":[-170,-225,1116,931],"ascender":718,"descender":-207,"xHeight":523,"capHeight":718,"glyphNames":"space exclam quotedbl numbersign dollar percent ampersand quotesingle parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight nine colon semicolon less equal greater question at A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore grave a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde Euro quotesinglbase florin quotedblbase ellipsis dagger daggerdbl circumflex perthousand Scaron guilsinglleft OE Zcaron quoteleft quoteright quotedblleft quotedblright bullet endash emdash tilde trademark scaron guilsinglright oe zcaron ydieresis exclamdown cent sterling currency yen brokenbar section dieresis copyright ordfeminine guillemotleft logicalnot registered macron degree plusminus twosuperior threesuperior acute mu paragraph periodcentered cedilla onesuperior ordmasculine guillemotright onequarter onehalf threequarters questiondown Agrave Aacute Acircumflex Atilde Adieresis Aring AE Ccedilla Egrave Eacute Ecircumflex Edieresis Igrave Iacute Icircumflex Idieresis Eth Ntilde Ograve Oacute Ocircumflex Otilde Odieresis multiply Oslash Ugrave Uacute Ucircumflex Udieresis Yacute Thorn germandbls agrave aacute acircumflex atilde adieresis aring ae ccedilla egrave eacute ecircumflex edieresis igrave iacute icircumflex idieresis eth ntilde ograve oacute ocircumflex otilde odieresis divide oslash ugrave uacute ucircumflex udieresis yacute thorn","glyphWidths":[278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,556,222,556,333,1000,556,556,333,1000,667,333,1000,611,222,222,333,333,350,556,1000,333,1000,500,333,944,500,500,333,556,556,556,556,260,556,333,737,370,556,584,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556],"kernPairs":[-180,[10332,2],-160,[9569],-150,[8182,2],-140,[9517,54,70,1552,1074,1,1,51,4,10,105,1,1,1,1,1,3,1,1,1,7,1,1,1,1,2,26464,1,1,51,4,10,105,1,1,2,1,3,1,1,1,7,1,1,1,1,2],-125,[11622,2],-120,[7147,3206,119,1,1,1,1,1,715,2,19,32,4,10,3,3,2,2,63,1,1,1,1,1,27,1,1,2,1,4,1,1,7,1,1,2,2,1,1,1,1,1,21339,215,215,215,215,215],-110,[9512,2,2774,52,67,1,1,1,1,1,52,1,1,1,26481,52,67,1,1,1,1,1,52,1,1,1],-100,[2689,2,428,2,4031,124,11871,2,6878,2,6708,124,91,124,91,124,91,124,91,124,91,124,11871,2],-95,[44732,2],-90,[57,124,7616,124],-85,[12302,123,1,1,1,1,2,26531,123,1,1,1,1,2,5717],-80,[8203,119,1,1,1,1,1,3296,20,36,10,73,1,1,1,1,1,35,1,1,1,7,1,1,1,1,2,19,2,6663,2],-70,[7149,603,2,40,1721,647,124,1389,20,99,1,1,1,1,1,20,1,1,1,11613,9299,215,215,215,215,215,2798,124,91,124,91,124,91,124,91,124,306,124,1081,5704,1,2,32,92],-60,[108,2902,7151,1140,66,5,13,896,1,6435,2,17887,215,215,215,215,430,1045,1],-57,[23328,216],-55,[44785,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,5,27,3,64,1,1,1,1,1,2,1,1,1,1,1,1,1,1,2,1,1,1,1,1,2,1,1,1,1],-50,[52,2,5536,215,1343,2,122,1,1,1,960,119,1,1,1,1,1,933,42,32,49,1,1,1,1,2,37,701,230,10,113,1,1,1,7,1,1,1,1,2,276,3,124,927,119,1,1,1,1,1,5660,2,5859,14,1,34,9181,2,122,1,1,1,88,2,122,1,1,1,88,2,122,1,1,1,88,2,122,1,1,1,88,2,122,1,1,1,88,2,122,1,1,1,2669,215,215,215,215,430],-45,[8252],-40,[55,7126,1,2,32,92,465,22,97,1,1,1,1,1,1417,10,113,1,1,1,7,1,1,1,1,2,664,2,38,228,119,1,1,1,1,1,294,124,1,1,1,297,123,1,1,1,1,2,51,2,19,119,1,1,1,1,1,84,1,12,8,123,1,1,1,1,2,52,52,119,1,1,1,1,1,2188,2,2793,2,6866,8901,1,2,32,92,88,1,2,32,92,88,1,2,32,92,88,1,2,32,92,88,1,2,32,92,88,1,2,32,92,2594,2,38,175,2,38,175,2,38,175,2,38,175,2,38,390,2,38,175,2,19,119,1,1,1,1,1,70,2,19,119,1,1,1,1,1,70,2,19,119,1,1,1,1,1,70,2,19,119,1,1,1,1,1,4585,2,213,2,213,2,213,2,213,2],-35,[17212,2],-30,[110,7020,4,8,2,36,74,11,1,1,1,1,2,33,1,1,1,230,2,700,10,113,1,1,1,7,1,1,1,1,2,664,2,286,124,1,1,1,92,32,92,487,642,3,1089,10,6,107,1,1,1,7,1,1,1,1,2,1,1,1,1,2027,32,92,733,2,139,2,51,4,10,105,1,1,1,1,1,3,1,1,1,7,1,1,1,1,2,311,32,92,1380,1,32,92,91,32,92,519,1057,123,1,1,1,6127,7473,4,8,2,36,74,11,1,1,1,1,2,33,1,1,1,38,4,8,2,36,74,11,1,1,1,1,2,33,1,1,1,38,4,8,2,36,74,11,1,1,1,1,2,33,1,1,1,38,4,8,2,36,74,11,1,1,1,1,2,33,1,1,1,38,4,8,2,36,74,11,1,1,1,1,2,33,1,1,1,38,4,8,2,36,74,11,1,1,1,1,2,33,1,1,1,230,2,2406,215,215,215,215,430,1754,32,92,91,32,92,91,32,92,91,32,92,91,32,92,91,32,92,518,2,213,2,213,2,213,2,1505,1,32,92,90,1,32,92,90,1,32,92,90,1,32,92,90,1,32,92],-25,[18555,4,10,105,1,1,1,1,1,3,1,1,1,7,1,1,1,1,2],-20,[7322,2,1739,32,20,67,1,1,1,1,1,27,1,1,1,1,1,20,1,1,1,896,119,1,1,1,1,1,535,123,1,1,1,1,2,51,2,227,1,665,42,32,49,1,1,1,1,2,37,290,124,1609,1,204,9,1,3,32,88,1,1,1,1,77,442,2,32,92,1146,10,113,1,1,1,7,1,1,1,1,2,523,2344,4,10,105,1,1,1,1,1,3,1,1,1,7,1,1,1,1,2,3029,2,3706,4,10,105,1,1,1,1,1,3,1,1,1,7,1,1,1,1,2,10360,119,1,1,1,1,1,91,119,1,1,1,1,1,91,119,1,1,1,1,1,91,119,1,1,1,1,1,91,119,1,1,1,1,1,306,119,1,1,1,1,1,991,124,534,1,214,1,214,1,214,1,214,1,214,1,418,227,2,32,92,89,2,32,92,89,2,32,92,89,2,32,92,1163,2559,4,10,105,1,1,1,1,1,3,1,1,1,7,1,1,1,1,2],-15,[14417,430,2,1795,32,92,91,32,92,88,1,785,2,911,119,1,1,1,1,1,525,10,113,1,1,1,7,1,1,1,1,2,5609,2,700,10,113,1,1,1,7,1,1,1,1,2,15069,215,2,213,2,213,2,213,2,1365,32,92,88,1,214,1,214,1,214,1,214,1],-10,[7363,124,1,1,1,3098,124,1,1,1,3541,1091,1293,124,1,1,1,88,124,1,1,1,713,119,1,1,1,1,1,955,10,113,1,1,1,7,1,1,1,1,2,24387,124,1,1,1],15,[17703,2,1,9,111,1,1,1,10,1,1,1],25,[17707,1,123],30,[17656,1,53,6,3,32,92],40,[17714],50,[15159],60,[15161]]},"Courier":{"name":"Courier","bbox":[-23,-250,715,805],"ascender":629,"descender":-157,"xHeight":426,"capHeight":562,"glyphNames":"space exclam quotedbl numbersign dollar percent ampersand quotesingle parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight nine colon semicolon less equal greater question at A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore grave a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde Euro quotesinglbase florin quotedblbase ellipsis dagger daggerdbl circumflex perthousand Scaron guilsinglleft OE Zcaron quoteleft quoteright quotedblleft quotedblright bullet endash emdash tilde trademark scaron guilsinglright oe zcaron ydieresis exclamdown cent sterling currency yen brokenbar section dieresis copyright ordfeminine guillemotleft logicalnot registered macron degree plusminus twosuperior threesuperior acute mu paragraph periodcentered cedilla onesuperior ordmasculine guillemotright onequarter onehalf threequarters questiondown Agrave Aacute Acircumflex Atilde Adieresis Aring AE Ccedilla Egrave Eacute Ecircumflex Edieresis Igrave Iacute Icircumflex Idieresis Eth Ntilde Ograve Oacute Ocircumflex Otilde Odieresis multiply Oslash Ugrave Uacute Ucircumflex Udieresis Yacute Thorn germandbls agrave aacute acircumflex atilde adieresis aring ae ccedilla egrave eacute ecircumflex edieresis igrave iacute icircumflex idieresis eth ntilde ograve oacute ocircumflex otilde odieresis divide oslash ugrave uacute ucircumflex udieresis yacute thorn","glyphWidths":[600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600],"kernPairs":[]},"CourierBold":{"name":"Courier-Bold","bbox":[-113,-250,749,801],"ascender":629,"descender":-157,"xHeight":439,"capHeight":562,"glyphNames":"space exclam quotedbl numbersign dollar percent ampersand quotesingle parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight nine colon semicolon less equal greater question at A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore grave a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde Euro quotesinglbase florin quotedblbase ellipsis dagger daggerdbl circumflex perthousand Scaron guilsinglleft OE Zcaron quoteleft quoteright quotedblleft quotedblright bullet endash emdash tilde trademark scaron guilsinglright oe zcaron ydieresis exclamdown cent sterling currency yen brokenbar section dieresis copyright ordfeminine guillemotleft logicalnot registered macron degree plusminus twosuperior threesuperior acute mu paragraph periodcentered cedilla onesuperior ordmasculine guillemotright onequarter onehalf threequarters questiondown Agrave Aacute Acircumflex Atilde Adieresis Aring AE Ccedilla Egrave Eacute Ecircumflex Edieresis Igrave Iacute Icircumflex Idieresis Eth Ntilde Ograve Oacute Ocircumflex Otilde Odieresis multiply Oslash Ugrave Uacute Ucircumflex Udieresis Yacute Thorn germandbls agrave aacute acircumflex atilde adieresis aring ae ccedilla egrave eacute ecircumflex edieresis igrave iacute icircumflex idieresis eth ntilde ograve oacute ocircumflex otilde odieresis divide oslash ugrave uacute ucircumflex udieresis yacute thorn","glyphWidths":[600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600],"kernPairs":[]},"CourierOblique":{"name":"Courier-Oblique","bbox":[-27,-250,849,805],"ascender":629,"descender":-157,"xHeight":426,"capHeight":562,"glyphNames":"space exclam quotedbl numbersign dollar percent ampersand quotesingle parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight nine colon semicolon less equal greater question at A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore grave a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde Euro quotesinglbase florin quotedblbase ellipsis dagger daggerdbl circumflex perthousand Scaron guilsinglleft OE Zcaron quoteleft quoteright quotedblleft quotedblright bullet endash emdash tilde trademark scaron guilsinglright oe zcaron ydieresis exclamdown cent sterling currency yen brokenbar section dieresis copyright ordfeminine guillemotleft logicalnot registered macron degree plusminus twosuperior threesuperior acute mu paragraph periodcentered cedilla onesuperior ordmasculine guillemotright onequarter onehalf threequarters questiondown Agrave Aacute Acircumflex Atilde Adieresis Aring AE Ccedilla Egrave Eacute Ecircumflex Edieresis Igrave Iacute Icircumflex Idieresis Eth Ntilde Ograve Oacute Ocircumflex Otilde Odieresis multiply Oslash Ugrave Uacute Ucircumflex Udieresis Yacute Thorn germandbls agrave aacute acircumflex atilde adieresis aring ae ccedilla egrave eacute ecircumflex edieresis igrave iacute icircumflex idieresis eth ntilde ograve oacute ocircumflex otilde odieresis divide oslash ugrave uacute ucircumflex udieresis yacute thorn","glyphWidths":[600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600],"kernPairs":[]},"CourierBoldOblique":{"name":"Courier-BoldOblique","bbox":[-57,-250,869,801],"ascender":629,"descender":-157,"xHeight":439,"capHeight":562,"glyphNames":"space exclam quotedbl numbersign dollar percent ampersand quotesingle parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight nine colon semicolon less equal greater question at A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore grave a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde Euro quotesinglbase florin quotedblbase ellipsis dagger daggerdbl circumflex perthousand Scaron guilsinglleft OE Zcaron quoteleft quoteright quotedblleft quotedblright bullet endash emdash tilde trademark scaron guilsinglright oe zcaron ydieresis exclamdown cent sterling currency yen brokenbar section dieresis copyright ordfeminine guillemotleft logicalnot registered macron degree plusminus twosuperior threesuperior acute mu paragraph periodcentered cedilla onesuperior ordmasculine guillemotright onequarter onehalf threequarters questiondown Agrave Aacute Acircumflex Atilde Adieresis Aring AE Ccedilla Egrave Eacute Ecircumflex Edieresis Igrave Iacute Icircumflex Idieresis Eth Ntilde Ograve Oacute Ocircumflex Otilde Odieresis multiply Oslash Ugrave Uacute Ucircumflex Udieresis Yacute Thorn germandbls agrave aacute acircumflex atilde adieresis aring ae ccedilla egrave eacute ecircumflex edieresis igrave iacute icircumflex idieresis eth ntilde ograve oacute ocircumflex otilde odieresis divide oslash ugrave uacute ucircumflex udieresis yacute thorn","glyphWidths":[600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600,600],"kernPairs":[]}};

function installStandardFontFallback() {
  if (Module.__i7FontFallback) return;
  Module.__i7FontFallback = true;

  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    try {
      return originalLoad.call(this, request, ...rest);
    } catch (err) {
      const match = /^#standard-fonts[\\/]([A-Za-z]+)$/.exec(String(request || ""))
                 || /standard-fonts[\\/]([A-Za-z]+)\.cjs$/.exec(String(request || ""));
      if (match && EMBEDDED_FONTS[match[1]]) return EMBEDDED_FONTS[match[1]];
      throw err;
    }
  };
}
installStandardFontFallback();

const PDFDocument = require("pdfkit");

/* ---------- palette, matching the printed invoice ---------- */
const INK       = "#10161f";
const LIME      = "#c6fa02";
const TEXT      = "#141b25";
const SOFT      = "#5f6b7d";
const RULE      = "#ccd3de";
const RULE_SOFT = "#e7eaf1";
const APPLE     = "#111111";
const COMPANY   = "#7a8699";

const PAGE_W = 595.28;                 // A4 at 72dpi
const M = 42;                          // margin
const CONTENT_W = PAGE_W - M * 2;

const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const telHref = (phone) => "tel:" + String(phone || "").replace(/[^\d+]/g, "");

const WTYPE = {
  shop:       { label: "Limited Warranty",           short: "Limited",   colour: LIME },
  apple_care: { label: "AppleCare Limited warranty", short: "AppleCare", colour: APPLE },
  company:    { label: "Company warranty",           short: "Company",   colour: COMPANY },
  none:       { label: "No Warranty",                short: "None",      colour: "#b8bfcb",
                noCover: true }
};
const wt = (t) => WTYPE[t] || WTYPE.shop;

function money(c) {
  const neg = c < 0; c = Math.abs(Math.round(c || 0));
  const s = (c / 100).toFixed(2).split(".");
  s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-" : "") + s[0] + "." + s[1];
}

function niceDate(v) {
  if (!v) return "\u2014";
  const p = String(v).split("-");
  if (p.length !== 3) return String(v);
  return `${p[2]} ${MON[Number(p[1]) - 1]} ${p[0]}`;
}

/* Column geometry. Right-aligned money columns share one grid so
   every figure on the page lines up under the one above it. */
const COL = {
  idx:    M,
  desc:   M + 24,
  qty:    { x: M + 300, w: 42 },
  unit:   { x: M + 348, w: 78 },
  amount: { x: M + 432, w: CONTENT_W - 432 }
};

/* Warranty terms are stored one point per line. A leading label before
   the first colon is set in bold so each point reads as heading + body. */
function drawTermList(doc, text, x, y, width, opts = {}) {
  const size = opts.size || 7.5;
  const lines = String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return y;

  const indent = 9;
  for (const line of lines) {
    const colon = line.indexOf(":");
    const hasLabel = colon > 0 && colon < 48;

    doc.font("Helvetica").fontSize(size).fillColor(SOFT);
    const startY = y;

    if (hasLabel) {
      doc.font("Helvetica-Bold").fillColor(TEXT)
         .text(line.slice(0, colon + 1), x + indent, y,
               { width: width - indent, continued: true, lineGap: 1.5 });
      doc.font("Helvetica").fillColor(SOFT)
         .text(" " + line.slice(colon + 1).trim(), { lineGap: 1.5 });
    } else {
      doc.text(line, x + indent, y, { width: width - indent, lineGap: 1.5 });
    }

    /* bullet, drawn after the text so its baseline is known */
    doc.circle(x + 3, startY + size * 0.45, 1.15).fill(RULE);
    doc.fillColor(SOFT);

    y = doc.y + 4;
  }
  return y;
}

function buildInvoicePdf(inv) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: M, bufferPages: true,
                                  info: { Title: `Invoice ${inv.number}`,
                                          Author: inv.biz_name || "I7SEVEN MOBILE" } });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const cur  = inv.currency || "LKR";
    const mode = inv.tax_mode || "none";
    const items = inv.items || [];

    /* ---------------- header band ---------------- */
    doc.rect(0, 0, PAGE_W, 96).fill(INK);

    const logo = path.join(__dirname, "..", "public", "logo.png");
    let usedLogo = false;
    try {
      /* Read the bytes rather than passing a path: the standalone PDFKit
         build is the browser one and only accepts a buffer. */
      if (fs.existsSync(logo)) {
        doc.image(fs.readFileSync(logo), M, 26, { width: 132 });
        usedLogo = true;
      }
    } catch (e) {
      console.error("Logo could not be embedded:", e.message);
    }
    if (!usedLogo) {
      doc.font("Helvetica-BoldOblique").fontSize(23).fillColor(LIME).text("I7SEVEN", M, 30);
    }
    doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#e8edf4")
       .text("M O B I L E", M + 2, 70, { characterSpacing: 2.4 });

    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#8d99aa")
       .text(mode === "none" ? "INVOICE" : "TAX INVOICE", M, 26,
             { width: CONTENT_W, align: "right", characterSpacing: 2 });
    doc.font("Courier-Bold").fontSize(16).fillColor(LIME)
       .text(inv.number || "", M, 40, { width: CONTENT_W, align: "right" });

    if (mode !== "none" && (inv.vat_no || "").trim()) {
      doc.font("Helvetica-Bold").fontSize(6).fillColor("#8d99aa")
         .text("VAT REG. NO.", M, 64, { width: CONTENT_W, align: "right", characterSpacing: 1.2 });
      doc.font("Courier").fontSize(8.5).fillColor("#e8edf4")
         .text(inv.vat_no, M, 74, { width: CONTENT_W, align: "right" });
    }

    doc.rect(0, 96, PAGE_W, 3).fill(LIME);

    /* ---------------- business block ---------------- */
    /* Phone and email are tappable; the address is plain text. The
       wordmark above already carries the shop name. */
    let y = 122;
    const addr  = (inv.biz_address || "").trim();
    const phone = (inv.biz_phone || "").trim();
    const mail  = (inv.biz_email || "").trim();

    if (addr || phone || mail) {
      doc.font("Helvetica").fontSize(8.5).fillColor(SOFT);
      if (addr) {
        doc.text(addr, M, y, { width: 320, lineGap: 1.5 });
        y = doc.y + 1;
      }
      /* Link annotations need an explicit width. Without one, some
         PDFKit builds compute NaN and throw "unsupported number". */
      if (phone || mail) {
        let x = M;
        if (phone) {
          const w = doc.widthOfString(phone) + 1;
          doc.text(phone, x, y, { width: w, lineBreak: false, link: telHref(phone) });
          x += w;
          if (mail) {
            const sep = "  \u00b7  ";
            const sw = doc.widthOfString(sep) + 1;
            doc.text(sep, x, y, { width: sw, lineBreak: false });
            x += sw;
          }
        }
        if (mail) {
          doc.text(mail, x, y, { width: doc.widthOfString(mail) + 1,
                                 lineBreak: false, link: "mailto:" + mail });
        }
        y += 12;
      }
      y += 12;
    } else {
      doc.font("Helvetica").fontSize(8.5).fillColor(SOFT)
         .text(inv.biz_lines || "", M, y, { width: 320, lineGap: 1.5 });
      y = doc.y + 14;
    }

    /* ---------------- billed-to strip ---------------- */
    doc.moveTo(M, y).lineTo(M + CONTENT_W, y).lineWidth(1.4).strokeColor(INK).stroke();
    y += 11;

    let billBottom = y;
    const labelled = (label, value, x, w, mono) => {
      doc.font("Helvetica-Bold").fontSize(6).fillColor(SOFT)
         .text(label.toUpperCase(), x, y, { width: w, characterSpacing: 1.2 });
      doc.font(mono ? "Courier" : "Helvetica").fontSize(9.5).fillColor(TEXT)
         .text(value, x, y + 10, { width: w, lineGap: 1 });
      if (doc.y > billBottom) billBottom = doc.y;
    };

    const billTo = [inv.cust_name || "\u2014", inv.cust_address || "", inv.cust_phone || ""]
      .filter(Boolean).join("\n");
    /* Only show Due when the customer actually owes money later. */
    const showDue = Boolean(inv.due_date) && inv.due_date !== inv.issue_date;
    labelled("Billed to", billTo, M, 280, false);
    labelled("Issued", niceDate(inv.issue_date), showDue ? M + 330 : M + 400, 110, true);
    if (showDue) labelled("Due", niceDate(inv.due_date), M + 440, 110, true);

    y = billBottom + 5;

    if ((inv.cust_nic || "").trim()) {
      const nic = `NIC  ${inv.cust_nic}`;
      const w = doc.font("Courier").fontSize(8.5).widthOfString(nic) + 12;
      doc.roundedRect(M, y, w, 15, 2).lineWidth(0.7)
         .fillAndStroke("#f2f5e3", "#d9e5a0");
      doc.fillColor(TEXT).font("Courier").fontSize(8.5).text(nic, M + 6, y + 4);
      y += 21;
    }

    y += 4;
    doc.moveTo(M, y).lineTo(M + CONTENT_W, y).lineWidth(0.7).strokeColor(RULE).stroke();
    y += 16;

    /* ---------------- line items ---------------- */
    const head = (label, x, w, align) =>
      doc.font("Helvetica-Bold").fontSize(6).fillColor(SOFT)
         .text(label.toUpperCase(), x, y, { width: w, align, characterSpacing: 1.1 });

    head("Description", COL.desc, 260, "left");
    head("Qty",        COL.qty.x,    COL.qty.w,    "right");
    head("Unit price", COL.unit.x,   COL.unit.w,   "right");
    head("Amount",     COL.amount.x, COL.amount.w, "right");
    y += 10;
    doc.moveTo(M, y).lineTo(M + CONTENT_W, y).lineWidth(1).strokeColor(INK).stroke();
    y += 9;

    const BOTTOM = 800;                          // A4 842pt less the 42pt margin
    const pageBreak = (needed) => {
      if (y + needed < BOTTOM) return;
      doc.addPage();
      y = M;
    };

    items.forEach((it, i) => {
      const days = Number(it.warranty_days) || 0;
      const hasImei = (it.imei || "").trim();
      pageBreak(hasImei || days || it.warranty_type === "none" ? 52 : 26);

      const rowTop = y;
      doc.font("Courier").fontSize(7.5).fillColor(SOFT)
         .text(String(i + 1).padStart(2, "0"), COL.idx, y + 1.5, { width: 20 });
      doc.font("Helvetica").fontSize(9.5).fillColor(TEXT)
         .text(it.description || "\u2014", COL.desc, y, { width: 250 });
      let lineY = doc.y;

      if (hasImei) {
        doc.font("Courier").fontSize(7.5).fillColor(SOFT)
           .text(`IMEI  ${it.imei}`, COL.desc, lineY + 2, { width: 250 });
        lineY = doc.y;
      }

      const noCover = it.warranty_type === "none";
      if (days > 0 || noCover) {
        const t = wt(it.warranty_type);
        const barY = lineY + 4;
        doc.font("Helvetica-Bold").fontSize(7.5);
        const txt = noCover
          ? t.label
          : `${t.label} ${days} days  \u00b7  valid to ${niceDate(it.warranty_until)}`;
        const h = doc.heightOfString(txt, { width: 240 });
        doc.rect(COL.desc, barY, 2.2, h).fill(t.colour);
        doc.fillColor(SOFT).text(txt, COL.desc + 7, barY, { width: 240 });
        lineY = doc.y;
      }

      /* money columns sit on the row's first baseline */
      doc.font("Courier").fontSize(9.5).fillColor(TEXT);
      doc.text(String(Number(it.qty) || 0), COL.qty.x,    rowTop, { width: COL.qty.w,    align: "right" });
      doc.text(money(it.unit_price_c),      COL.unit.x,   rowTop, { width: COL.unit.w,   align: "right" });
      doc.text(money(it.amount_c),          COL.amount.x, rowTop, { width: COL.amount.w, align: "right" });

      y = Math.max(lineY, rowTop + 12) + 8;
      doc.moveTo(M, y).lineTo(M + CONTENT_W, y).lineWidth(0.5).strokeColor(RULE_SOFT).stroke();
      y += 9;
    });

    /* ---------------- totals ---------------- */
    pageBreak(140);
    y += 6;
    /* Wide enough for a seven-figure total in Courier-Bold 13pt without
       wrapping. Right edges still line up with the Amount column above. */
    const LAB_X = M + 160, LAB_W = 164;          // ends at M+324
    const VAL_X = M + 330, VAL_W = CONTENT_W - 330;

    const sumRow = (label, value, opts = {}) => {
      if (opts.rule) {
        doc.moveTo(LAB_X, y).lineTo(M + CONTENT_W, y)
           .lineWidth(opts.heavy ? 1.4 : 0.5)
           .strokeColor(opts.heavy ? INK : RULE).stroke();
        y += opts.heavy ? 9 : 6;
      }
      doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica")
         .fontSize(opts.bold ? 7.5 : 9).fillColor(opts.bold ? TEXT : SOFT)
         .text(opts.bold ? label.toUpperCase() : label, LAB_X, y + (opts.bold ? 3 : 0),
               { width: LAB_W, align: "right", characterSpacing: opts.bold ? 1.1 : 0 });
      doc.font(opts.bold ? "Courier-Bold" : "Courier")
         .fontSize(opts.bold ? 12.5 : 9.5).fillColor(TEXT)
         .text(value, VAL_X, y, { width: VAL_W, align: "right", lineBreak: false });
      y += opts.bold ? 20 : 15;
    };

    sumRow(mode === "incl" ? "Subtotal (VAT inclusive)" : "Subtotal", `${cur} ${money(inv.subtotal_c)}`);
    if (inv.discount_c) sumRow("Discount", `-${cur} ${money(inv.discount_c)}`);

    if (mode === "vat_sscl") {
      if (inv.discount_c) sumRow("Value of goods", `${cur} ${money(inv.net_c)}`, { rule: true });
      sumRow(`SSCL ${Number(inv.sscl_rate) || 0}%`, `${cur} ${money(inv.sscl_c)}`);
      sumRow("Value liable to VAT", `${cur} ${money(inv.taxable_c)}`, { rule: true });
      sumRow(`VAT ${Number(inv.vat_rate) || 0}%`, `${cur} ${money(inv.vat_c)}`);
    } else if (mode === "vat") {
      sumRow(`VAT ${Number(inv.vat_rate) || 0}%`, `${cur} ${money(inv.vat_c)}`);
    }

    sumRow("Total due", `${cur} ${money(inv.total_c)}`, { rule: true, heavy: true, bold: true });

    if (mode === "incl") {
      doc.font("Courier").fontSize(7.5).fillColor(SOFT)
         .text(`Includes VAT ${Number(inv.vat_rate) || 0}% of ${cur} ${money(inv.incl_vat_c)}`,
               LAB_X, y, { width: LAB_W + VAL_W, align: "right" });
      y += 14;
    }

    /* ---------------- warranty ---------------- */
    const wItems = items.filter((it) => Number(it.warranty_days) > 0);
    if (wItems.length || (inv.warranty_text || "").trim()) {
      pageBreak(120);
      y += 14;
      const boxTop = y;

      doc.rect(M, y, CONTENT_W, 16).fill(LIME);
      doc.font("Helvetica-Bold").fontSize(6.5).fillColor(INK)
         .text("WARRANTY TERMS & CONDITIONS", M + 10, y + 5, { characterSpacing: 2 });
      y += 24;

      if (wItems.length) {
        const c = { item: M + 10, type: M + 288, days: M + 372, until: M + 412 };
        doc.font("Helvetica-Bold").fontSize(5.8).fillColor(SOFT);
        doc.text("ITEM", c.item, y, { characterSpacing: 1 });
        doc.text("TYPE", c.type, y, { characterSpacing: 1 });
        doc.text("DAYS", c.days, y, { width: 32, align: "right", characterSpacing: 1 });
        doc.text("COVERED UNTIL", c.until, y, { width: 90, align: "right", characterSpacing: 1 });
        y += 9;
        doc.moveTo(M + 10, y).lineTo(M + CONTENT_W - 10, y)
           .lineWidth(0.5).strokeColor(RULE_SOFT).stroke();
        y += 6;

        for (const it of wItems) {
          pageBreak(26);
          const label = (it.description || "") + (it.imei ? `  \u00b7  ${it.imei}` : "");
          doc.font("Helvetica").fontSize(8).fillColor(TEXT)
             .text(label, c.item, y, { width: 270 });
          const rowH = doc.y - y;
          doc.font("Helvetica-Bold").fontSize(6.5).fillColor(SOFT)
             .text(wt(it.warranty_type).short.toUpperCase(), c.type, y + 1,
                   { width: 78, characterSpacing: 0.8 });
          doc.font("Courier").fontSize(8).fillColor(TEXT)
             .text(String(it.warranty_days), c.days, y, { width: 32, align: "right" });
          doc.text(niceDate(it.warranty_until), c.until, y, { width: 90, align: "right" });
          y += Math.max(rowH, 10) + 5;
        }
        y += 2;
      }

      if ((inv.warranty_text || "").trim()) {
        y = drawTermList(doc, inv.warranty_text, M + 10, y, CONTENT_W - 20);
      }
      y += 10;
      doc.rect(M, boxTop, CONTENT_W, y - boxTop).lineWidth(0.8).strokeColor(INK).stroke();
      y += 6;
    }

    /* ---------------- terms ---------------- */
    if ((inv.terms || "").trim()) {
      /* Terms and the footer belong together. Measure both and move the
         whole block to the next page rather than splitting it. */
      doc.font("Helvetica").fontSize(7.5);
      const termsH = doc.heightOfString(inv.terms, { width: CONTENT_W, lineGap: 2 });
      pageBreak(12 + 9 + 10 + termsH + 42);
      y += 12;
      doc.moveTo(M, y).lineTo(M + CONTENT_W, y).lineWidth(0.5).strokeColor(RULE).stroke();
      y += 9;
      doc.font("Helvetica-Bold").fontSize(6).fillColor(SOFT)
         .text("TERMS AND CONDITIONS", M, y, { characterSpacing: 1.3 });
      y += 10;
      y = drawTermList(doc, inv.terms, M, y, CONTENT_W);
    }

    /* ---------------- footer ---------------- */
    pageBreak(34);
    y += 16;
    doc.moveTo(M, y).lineTo(M + CONTENT_W, y).lineWidth(0.5).strokeColor(RULE_SOFT).stroke();
    y += 8;
    doc.font("Helvetica").fontSize(8).fillColor(SOFT)
       .text("Thank you for your business.", M, y, { width: 260 });
    doc.font("Courier").fontSize(8).fillColor(SOFT)
       .text((inv.cashier ? `Served by ${inv.cashier}  \u00b7  ` : "") + "info@iseven.lk",
             M + 260, y, { width: CONTENT_W - 260, align: "right" });

    /* page numbers, only when it runs to more than one page */
    const range = doc.bufferedPageRange();
    if (range.count > 1) {
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        const keep = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        doc.font("Helvetica").fontSize(7).fillColor(SOFT)
           .text(`${inv.number}   \u00b7   Page ${i + 1} of ${range.count}`,
                 M, doc.page.height - 28,
                 { width: CONTENT_W, align: "center", lineBreak: false });
        doc.page.margins.bottom = keep;
      }
    }

    doc.end();
  });
}

async function invoicePdfAttachment(inv) {
  return {
    filename: `${inv.number}.pdf`,
    content: await buildInvoicePdf(inv),
    contentType: "application/pdf"
  };
}

module.exports = { buildInvoicePdf, invoicePdfAttachment };
