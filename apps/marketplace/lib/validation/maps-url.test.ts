import { describe, expect, it } from "vitest";
import { shopProfileSchema } from "./vendor";

const parse = (maps_url: string) =>
  shopProfileSchema.safeParse({ name: "BSR Bike Shop", maps_url });

describe("a shop's Google Maps link", () => {
  it.each([
    "https://maps.app.goo.gl/AbCdEf123",
    "https://goo.gl/maps/AbCdEf123",
    "https://www.google.com/maps/place/BSR/@13.7,100.5,17z",
    "https://google.com/maps?q=13.7,100.5",
    "https://maps.google.com/?cid=123",
    "https://www.google.co.th/maps/place/BSR",
    "https://maps.google.co.th/maps?q=BSR",
    "https://g.co/kgs/abc123",
  ])("accepts %s", (url) => {
    expect(parse(url).success).toBe(true);
  });

  it.each([
    "https://evil.example/maps",
    "http://maps.app.goo.gl/AbCdEf123",
    "https://maps.app.goo.gl.evil.example/x",
    "https://evil.example/https://www.google.com/maps",
    "https://www.google.com.evil.example/maps",
    "https://www.google.com@evil.example/maps",
    "https://user:pw@www.google.com/maps",
    "https://www.google.com:8443/maps",
    "https://www.google.com/url?q=https://evil.example",
    "https://goo.gl/AbCdEf",
    "javascript:alert(1)",
    "data:text/html,x",
    "//www.google.com/maps",
  ])("refuses %s", (url) => {
    expect(parse(url).success).toBe(false);
  });
});
