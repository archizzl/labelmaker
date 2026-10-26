import { describe, expect, it } from "vitest";
import { isPrivateIp, publicAddressProblem } from "../public-address";

describe("a public website's address", () => {
  it("takes Bandcamp pages and custom domains", () => {
    for (const u of ["https://glassharbor.bandcamp.com/music", "http://records.example.com/album/x", "https://f4.bcbits.com/img/a1.jpg", "https://8.8.8.8/"]) {
      expect(publicAddressProblem(u)).toBeNull();
    }
  });

  it("refuses this computer, home networks and odd ports", () => {
    for (const u of [
      "http://localhost/",
      "http://127.0.0.1/",
      "http://2130706433/",
      "http://192.168.1.1/admin",
      "http://10.0.0.5/",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/",
      "http://[::ffff:192.168.1.1]/",
      "http://router.local/",
      "http://nas.home.arpa/",
      "http://printer/",
      "https://glassharbor.bandcamp.com:8443/",
      "file:///etc/passwd",
    ]) {
      expect(publicAddressProblem(u), u).not.toBeNull();
    }
  });

  it("knows private addresses", () => {
    expect(isPrivateIp("172.20.1.1")).toBe(true);
    expect(isPrivateIp("172.32.1.1")).toBe(false);
    expect(isPrivateIp("100.64.0.1")).toBe(true);
    expect(isPrivateIp("fd12::1")).toBe(true);
    expect(isPrivateIp("fe80::1")).toBe(true);
    expect(isPrivateIp("2606:4700::1111")).toBe(false);
  });
});
