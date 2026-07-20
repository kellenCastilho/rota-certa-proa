export default function Card({ children, className = '', ...props }) {
  return <section className={`ds-card ${className}`.trim()} {...props}>{children}</section>
}
