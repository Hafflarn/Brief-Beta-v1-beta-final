export default function Logo({
  success = false,
  large = false,
}: {
  success?: boolean;
  large?: boolean;
}) {
  return (
    <div
      className={`logo ${large ? "logo-large" : ""} ${success ? "login-ok" : ""}`}
      aria-label="Brief"
    >
      <img className="logo-dark" src="/brand/brief-horizontal.png" alt="brēf" />
      <img className="logo-light" src="/brand/brief-light.png" alt="brēf" />
      {success && (
        <svg
          className="logo-animation"
          viewBox="0 0 1983 793"
          aria-hidden="true"
        >
          <g className="success-tick">
            <circle
              cx="680"
              cy="410"
              r="50"
              fill="#25d487"
              stroke="#05121b"
              strokeWidth="9"
            />
            <path
              d="m661 410 14 14 24-29"
              fill="none"
              stroke="#05121b"
              strokeWidth="12"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        </svg>
      )}
    </div>
  );
}
