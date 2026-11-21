/**
 * One table of Google Maps links, kept and refused, for the two places that
 * hold the rule: safeMapsUrl() (lib/maps-url.ts, tested in
 * lib/validation/maps-url.test.ts) and the trigger on shops.maps_url
 * (tests/db/security-audit.test.ts). Both suites run every row, so the app
 * and the database cannot drift apart unnoticed.
 */

export const KEPT_MAPS_URLS: readonly string[] = [
  // A normal place link, a search link (the demo seed's), a query link.
  "https://www.google.com/maps/place/BSR+Bike+Shop/@13.7139,100.5936,17z",
  "https://www.google.com/maps/search/?api=1&query=79%2F37+Soi+Phumichit%2C+Bangkok",
  "https://www.google.com/maps?q=13.7,100.5",
  "https://www.google.com/maps",
  "https://google.com/maps?q=13.7,100.5",
  "https://maps.google.com/maps?q=BSR",
  "https://www.google.co.th/maps/place/BSR",
  "https://google.co.th/maps/place/BSR",
  "https://maps.google.co.th/maps?q=BSR",
  // Share links.
  "https://maps.app.goo.gl/AbCdEf123",
  "https://goo.gl/maps/AbCdEf123",
  // ".." and "%2e" count in the path only.
  "https://www.google.com/maps/search/?api=1&query=Soi+8..9%2e",
  // A g.co short share link: /kgs/ and one name, nothing after it.
  "https://g.co/kgs/AbC123x",
  "https://g.co/kgs/abc123",
  "https://g.co/kgs/a_b-C9",
  // A classic business-listing link: no path, and cid (digits) alone.
  "https://maps.google.com/?cid=1234567890123456789",
  "https://www.google.com/?cid=42",
  "https://maps.google.com/?cid=123",
  "https://google.com/?cid=7",
  "https://maps.google.com?cid=123",
  "https://maps.google.com/?cid=" + "9".repeat(25),
];

export const REFUSED_MAPS_URLS: readonly string[] = [
  // Google's redirect address, straight and by way of a dot path.
  "https://www.google.com/maps/../url?q=https://evil.example",
  "https://www.google.com/maps/%2e%2e/url?q=https://evil.example",
  "https://www.google.com/maps/%2E%2E/url?q=https://evil.example",
  "https://www.google.com/maps/.%2e/url?q=https://evil.example",
  "https://www.google.com/maps/place/a..b",
  "https://www.google.com/url?q=https://evil.example",
  "https://maps.google.com/url?q=https://evil.example",
  // On a Google host, but not under /maps.
  "https://www.google.com/",
  "https://www.google.com/mapsfoo",
  "https://www.google.com/search?q=maps",
  "https://goo.gl/AbCdEf",
  "https://goo.gl/maps",
  // Hosts that are not on the list.
  "https://maps.google.com.de/maps",
  "https://www.google.de/maps",
  "https://www.google.com.au/maps",
  "https://evil.example/maps",
  "https://evil.example/https://www.google.com/maps",
  "https://www.google.com.evil.example/maps",
  "https://maps.app.goo.gl.evil.example/x",
  "https://WWW.GOOGLE.COM/maps",
  "https://maps.app.goo.gl",
  // g.co: only /kgs/ and one name of letters, digits, "_" and "-".
  "https://g.co/kgs/abc/def",
  "https://g.co/kgs/abc?x=1",
  "https://g.co/xyz",
  "https://g.co/",
  "http://g.co/kgs/abc",
  "https://g.co.evil.com/kgs/abc",
  "https://g.co/kgs/",
  "https://g.co/kgs/abc/",
  "https://g.co/kgs/abc?",
  "https://g.co/kgs/abc#x",
  "https://g.co/kgs/a.b",
  "https://g.co/kgs/café",
  "https://g.co/kgs/a%2Fb",
  "https://g.co:443/kgs/abc",
  "https://x@g.co/kgs/abc",
  "https://www.g.co/kgs/abc",
  // A listing link: cid alone, 1 to 25 digits, no path, three hosts only.
  "https://maps.google.com/?cid=12a3",
  "https://maps.google.com/?cid=1&q=x",
  "https://maps.google.com/?q=x&cid=1",
  "https://maps.google.com/?cid=",
  "https://maps.google.com/url?cid=1",
  "https://evil.com/?cid=1",
  "https://maps.google.com/?cid=" + "9".repeat(26),
  "https://maps.google.com/?cid=1#x",
  "https://maps.google.com/?cid=-1",
  "https://maps.google.com/?CID=1",
  "https://maps.google.com//?cid=1",
  "https://maps.google.com/?cid=1&cid=2",
  "https://maps.google.co.th/?cid=1",
  "https://maps.app.goo.gl?cid=1",
  "https://goo.gl/?cid=1",
  "https://maps.google.com:443/?cid=1",
  "https://x@maps.google.com/?cid=1",
  // A user part, a port.
  "https://www.google.com@evil.example/maps",
  "https://user:pw@www.google.com/maps",
  "https://www.google.com:8443/maps",
  "https://www.google.com:443/maps",
  // Not https, or not an address.
  "http://maps.app.goo.gl/AbCdEf123",
  "HTTPS://www.google.com/maps",
  "//www.google.com/maps",
  "javascript:alert(1)",
  "data:text/html,x",
  // A backslash, a space, a control character.
  "https://www.google.com/maps\\..\\url",
  "https:\\\\www.google.com/maps",
  "https://www.google.com/maps/place/BSR Bike",
  "https://www.google.com/maps\t/place",
  " https://www.google.com/maps",
];
