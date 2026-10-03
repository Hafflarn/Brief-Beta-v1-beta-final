/** Transparent vector rendering of Brief's existing mark. */
export default function Logo({ success = false, large = false }: { success?: boolean; large?: boolean }) {
  return <div className={`logo ${large ? "logo-large" : ""} ${success ? "login-ok" : ""}`} aria-label="Brief">
    <svg className="brief-vector" viewBox="300 125 1395 510" role="img" aria-label="brēf">
      <defs><linearGradient id={large ? "blue-large" : "blue-small"} x2="0" y2="1"><stop stopColor="#00d2eb"/><stop offset="1" stopColor="#008cfa"/></linearGradient><linearGradient id={large ? "person-large" : "person-small"} x2="1" y2="1"><stop stopColor="#718fa5"/><stop offset="1" stopColor="#28475e"/></linearGradient><linearGradient id={large ? "silver-large" : "silver-small"} x2="1" y2="1"><stop stopColor="#eef6fd"/><stop offset="1" stopColor="#91afc7"/></linearGradient></defs>
      <path d="M530 148h255q20 0 35 15l36 36q13 14 13 35v130q0 12-10 5l-52-52q-9-8-9-22v-24q0-11-8-18l-37-36q-9-8-23-8H584q-11 0-20-10l-39-39q-10-12 5-12" fill="#00dfb2"/>
      <path d="M349 384l55 54q12 11 12 24v22q0 10 8 17l25 25q10 9 23 9h104q13 0 22 10l40 40q10 13-5 13H435q-20 0-34-15l-44-45q-16-16-16-38V391q0-12 8-7" fill={`url(#${large ? "blue-large" : "blue-small"})`}/>
      <path d="M543 240h92v41q0 14 16 14h42v155q0 24-25 24H543q-26 0-26-25V266q0-26 26-26" fill="#f2f8fc"/>
      <path d="M646 243l44 42h-38q-6 0-6-7Z" fill={`url(#${large ? "silver-large" : "silver-small"})`}/>
      <rect x="540" y="296" width="25" height="25" rx="6" fill="#00d87b"/><rect x="540" y="329" width="25" height="25" rx="6" fill="#ffcf00"/><rect x="540" y="362" width="25" height="25" rx="6" fill="#ff3659"/>
      <path d="M583 309h45m-45 33h60m-60 33h45" stroke="#072333" strokeWidth="11" strokeLinecap="round"/>
      <g fill={`url(#${large ? "person-large" : "person-small"})`}><circle cx="438" cy="234" r="52"/><path d="M392 289q-35 0-35 45v38q0 13 10 24l66 62q14 7 13-8l-46-64 74 57q12 9 31 9h56q26 0 26-25t-27-26h-49l-90-101q-13-11-29-11"/></g>
      <g fill={`url(#${large ? "silver-large" : "silver-small"})`}><circle cx="802" cy="405" r="46"/><path d="M803 459q54 0 55 33v53q0 64-64 64h-54q-23 0-11-17l69-87-55 34q-8 5-18 5h-77q-12 0-20-8l-17-20q-12-16 5-24h113l43-27q13-6 31-6"/></g>
      <g className={success ? "success-tick" : ""}><circle cx="680" cy="410" r="49" fill={success ? "#25d487" : "#ffcf00"} stroke="#05121b" strokeWidth="9"/><path d="m660 410 15 15 26-31" stroke="#05121b" strokeWidth="12" fill="none" strokeLinecap="round" strokeLinejoin="round"/></g>
      <g fill="currentColor"><path fillRule="evenodd" d="M956 263q0-4 5-4h51q5 0 5 5v79q31-26 70-26c125 0 126 215-20 215-69 0-111-46-111-108Zm111 107c-70 0-70 108 0 108s70-108 0-108"/><path d="M1192 524V411q0-89 91-89h16q4 0 4 5v41q0 4-4 4h-17q-34 0-34 40v112q0 3-5 3h-46q-5 0-5-3"/><path fillRule="evenodd" d="M1365 441c7 45 58 55 92 24l50 4q4 1 1 8c-45 90-201 66-201-50 0-147 221-147 213 11q0 4-5 4Zm0-38h99c-14-45-84-49-99 0"/><path d="M1536 523V317q0-79 78-79h40q4 0 4 4v42q0 4-4 4h-33q-26 0-26 30v21h55q4 0 4 4v43q0 4-4 4h-55v133q0 4-5 4h-49q-5 0-5-4"/></g>
      <rect x="1341" y="260" width="139" height="39" rx="10" fill="#00c8ee"/>
    </svg>
  </div>;
}
