import { fireEvent, render, screen } from "@testing-library/react";
import { Grid, GridItem } from "../components/Grid";
import { ScreenSizeProvider, useScreenSize } from "./ScreenSizeProvider";
import { screenFromWidth, spanForScreen } from "./layout";

function WidthProbe() {
  const size = useScreenSize();
  return (
    <span>
      {size.name}:{size.gridColumns}
    </span>
  );
}

function setWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  fireEvent(window, new Event("resize"));
}

describe("layout", () => {
  afterEach(() => {
    setWidth(1024);
  });

  it("maps widths onto named screens and column counts", () => {
    expect(screenFromWidth(390)).toBe("phone");
    expect(screenFromWidth(720)).toBe("phone");
    expect(screenFromWidth(721)).toBe("tablet");
    expect(screenFromWidth(980)).toBe("tablet");
    expect(screenFromWidth(981)).toBe("laptop");
    expect(screenFromWidth(1180)).toBe("laptop");
    expect(screenFromWidth(1181)).toBe("desktop");
    expect(screenFromWidth(1700)).toBe("wide");
  });

  it("clamps spans to the current column count", () => {
    expect(spanForScreen("phone", { span: 4 })).toBe(4);
    expect(spanForScreen("phone", { span: 8 })).toBe(4);
    expect(spanForScreen("tablet", { span: 4 })).toBe(4);
    expect(spanForScreen("desktop", { span: 4, wide: 3 })).toBe(4);
    expect(spanForScreen("wide", { span: 4, wide: 3 })).toBe(3);
    expect(spanForScreen("laptop", { span: 8, phone: 4 })).toBe(8);
  });

  it("exposes the current screen through useScreenSize", () => {
    setWidth(390);
    render(
      <ScreenSizeProvider>
        <WidthProbe />
      </ScreenSizeProvider>,
    );
    expect(screen.getByText("phone:4")).toBeInTheDocument();

    setWidth(1700);
    expect(screen.getByText("wide:12")).toBeInTheDocument();
  });

  it("renders grid items at the span for the current screen", () => {
    setWidth(1280);
    const { container } = render(
      <ScreenSizeProvider>
        <Grid>
          <GridItem span={4} wide={3}>
            card
          </GridItem>
        </Grid>
      </ScreenSizeProvider>,
    );
    expect(
      (container.querySelector(".bling-grid-item") as HTMLElement).style
        .gridColumn,
    ).toBe("span 4");

    setWidth(1800);
    expect(
      (container.querySelector(".bling-grid-item") as HTMLElement).style
        .gridColumn,
    ).toBe("span 3");
  });
});
