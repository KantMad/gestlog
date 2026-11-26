import { describe, it, expect } from "vitest";
import { planNames, cleanPart, labelBase, naturalCompare, type PhotoItem } from "./photo-labels";

const label = (id: string, reference: string, colorCode: string, colorName = ""): PhotoItem => ({
  id,
  fileName: `${id}.jpg`,
  isLabel: true,
  label: { reference, colorCode, colorName },
});
const photo = (id: string, ext = "jpg"): PhotoItem => ({ id, fileName: `${id}.${ext}`, isLabel: false });

describe("photo-labels", () => {
  it("nomme les photos qui suivent l'étiquette REF-CODE-N", () => {
    const r = planNames([label("e1", "THTMANT_901", "209", "CARAMEL"), photo("p1"), photo("p2", "JPEG")]);
    expect(r.map((x) => x.newName)).toEqual([null, "THTMANT_901-209-1.jpg", "THTMANT_901-209-2.jpeg"]);
  });

  it("change de groupe à chaque nouvelle étiquette", () => {
    const r = planNames([label("e1", "A1", "1"), photo("p1"), label("e2", "B2", "2"), photo("p2"), photo("p3")]);
    expect(r.filter((x) => x.newName).map((x) => x.newName)).toEqual(["A1-1-1.jpg", "B2-2-1.jpg", "B2-2-2.jpg"]);
  });

  it("garde le nom d'origine des photos sans étiquette avant elles", () => {
    const r = planNames([photo("IMG_1"), label("e1", "A1", "1"), photo("p1")]);
    expect(r[0]).toEqual({ id: "IMG_1", newName: "IMG_1.jpg", groupBase: null });
  });

  it("continue la numérotation si la même étiquette revient", () => {
    const r = planNames([label("e1", "A1", "1"), photo("p1"), label("e2", "a1 ", "1"), photo("p2")]);
    expect(r[3].newName).toBe("A1-1-2.jpg");
  });

  it("exporte l'étiquette sur demande", () => {
    const r = planNames([label("e1", "A1", "1"), photo("p1")], true);
    expect(r[0].newName).toBe("A1-1-ETIQUETTE.jpg");
  });

  it("sans code couleur : REF-N", () => {
    expect(planNames([label("e1", "A1", ""), photo("p1")])[1].newName).toBe("A1-1.jpg");
  });

  it("étiquette illisible : les photos suivantes gardent leur nom", () => {
    const r = planNames([label("e1", "A1", "1"), photo("p1"), label("e2", "", ""), photo("p2")]);
    expect(r[3]).toEqual({ id: "p2", newName: "p2.jpg", groupBase: null });
  });

  it("nettoie les morceaux de nom", () => {
    expect(cleanPart(" thtmant 901/é ")).toBe("THTMANT_901E");
    expect(labelBase({ reference: "x", colorCode: "", colorName: "" })).toBe("X");
  });

  it("trie naturellement", () => {
    expect(["IMG_10.jpg", "IMG_2.jpg", "IMG_1.jpg"].sort(naturalCompare)).toEqual(["IMG_1.jpg", "IMG_2.jpg", "IMG_10.jpg"]);
  });
});
