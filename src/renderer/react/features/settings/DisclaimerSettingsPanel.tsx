import { useTranslation } from "../../i18n";
import "./DisclaimerSettingsPanel.css";
import { Card } from "../../components/ui/Card";

/** 邮箱行内图标（与旧版设置窗口免责声明保持一致）。 */
function EmailLineIcon() {
  return (
    <svg className="cy-disclaimer-icon" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M44 24V9H24H4V24V39H24" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M35 39L43 32L39 28L31 35V39H35Z" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 9L24 24L44 9" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 免责声明面板：设置页和首次启动流程共用同一份条款。 */
export function DisclaimerSettingsPanel() {
  const { t } = useTranslation();
  const p = (key: string) => t(`settingsPage.disclaimer.${key}`);

  return (
    <>
      <h1>{p("heading")}</h1>
      <p className="cy-settings-intro">{p("subheading")}</p>

      <div className="cy-settings-disclaimer">
        <Card as="article" className="cy-disclaimer-section">
          <h2>{p("section1.title")}</h2>
          <p>{p("section1.p1")}</p>
          <p>{p("section1.p2")}</p>
        </Card>

        <Card as="article" className="cy-disclaimer-section">
          <h2>{p("section2.title")}</h2>
          <p>{p("section2.p1")}</p>
          <p>{p("section2.p2")}</p>
        </Card>

        <Card as="article" className="cy-disclaimer-section">
          <h2>{p("section3.title")}</h2>
          <p>{p("section3.p1")}</p>
          <p>{p("section3.p2")}</p>
        </Card>

        <Card as="article" className="cy-disclaimer-section">
          <h2>{p("section4.title")}</h2>
          <p>{p("section4.p1")}</p>
          <p>{p("section4.p2")}</p>
        </Card>

        <Card as="article" className="cy-disclaimer-section">
          <h2>{p("section5.title")}</h2>
          <p>
            {p("section5.p1Before")}
            <strong>{p("section5.p1Emphasis")}</strong>
            {p("section5.p1After")}
          </p>
        </Card>

        <Card as="article" className="cy-disclaimer-section">
          <h2>{p("section6.title")}</h2>
          <p>{p("section6.p1")}</p>
          <ul>
            <li><EmailLineIcon /> {p("section6.email")}</li>
          </ul>
        </Card>

        <Card as="article" className="cy-disclaimer-section">
          <h2>{p("section7.title")}</h2>
          <p>{p("section7.p1")}</p>
          <ul>
            <li><EmailLineIcon /> {p("section7.email")}</li>
          </ul>
          <p>{p("section7.outro")}</p>
        </Card>

        <Card as="article" className="cy-disclaimer-section">
          <h2>{p("section8.title")}</h2>
          <p>{p("section8.p1")}</p>
          <p>{p("section8.p2")}</p>
          <ul>
            <li>{p("section8.li1")}</li>
            <li>{p("section8.li2")}</li>
            <li>{p("section8.li3")}</li>
            <li>{p("section8.li4")}</li>
          </ul>
        </Card>

        <Card as="article" className="cy-disclaimer-section">
          <h2>{p("section9.title")}</h2>
          <p>
            {p("section9.p1")}
            {p("section9.upLink")}
            {p("section9.p2")}
          </p>
        </Card>

        <Card as="article" className="cy-disclaimer-section">
          <h2>{p("section10.title")}</h2>
          <p>{p("section10.p1")}</p>
          <p>{p("section10.p2")}</p>
        </Card>

        <Card as="article" className="cy-disclaimer-section">
          <h2>{p("section11.title")}</h2>
          <p>{p("section11.p1")}</p>
        </Card>
      </div>
    </>
  );
}
