import type { Block, Inline } from "../src/page-view"

type Open = (id: string) => void

// Draws the block tree the main process built from a Page. Everything here is plain elements and text:
// the tree holds no markup, so nothing in a Page can inject any.
export function PageBlocks({ blocks, onOpen }: { blocks: Block[]; onOpen: Open }) {
  return (
    <>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} onOpen={onOpen} />
      ))}
    </>
  )
}

function BlockView({ block, onOpen }: { block: Block; onOpen: Open }) {
  switch (block.type) {
    case "heading": {
      // The tab's own title is the h1, so a Page's # heading is an h2.
      const Heading = `h${Math.min(block.depth + 1, 6)}` as "h2" | "h3" | "h4" | "h5" | "h6"
      return (
        <Heading>
          <Inlines parts={block.children} onOpen={onOpen} />
        </Heading>
      )
    }
    case "paragraph":
      return (
        <p>
          <Inlines parts={block.children} onOpen={onOpen} />
        </p>
      )
    case "list": {
      const List = block.ordered ? "ol" : "ul"
      return (
        <List>
          {block.items.map((item, index) => (
            <li key={index}>
              {item.checked !== null && (
                <input type="checkbox" checked={item.checked} disabled aria-label={item.checked ? "Done" : "Not done"} />
              )}
              <PageBlocks blocks={item.children} onOpen={onOpen} />
            </li>
          ))}
        </List>
      )
    }
    case "quote":
      return (
        <blockquote>
          <PageBlocks blocks={block.children} onOpen={onOpen} />
        </blockquote>
      )
    case "callout": {
      const title = <Inlines parts={block.title} onOpen={onOpen} />
      const body = <PageBlocks blocks={block.children} onOpen={onOpen} />
      return block.collapsed ? (
        <details className="callout" data-kind={block.kind}>
          <summary>{title}</summary>
          {body}
        </details>
      ) : (
        <div className="callout" data-kind={block.kind} role="note">
          <p className="callout-title">{title}</p>
          {body}
        </div>
      )
    }
    case "code":
      return (
        <pre>
          <code>{block.text}</code>
        </pre>
      )
    case "table":
      return (
        <table>
          <thead>
            <tr>
              {block.head.map((cell, index) => (
                <th key={index} scope="col">
                  <Inlines parts={cell} onOpen={onOpen} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, index) => (
                  <td key={index}>
                    <Inlines parts={cell} onOpen={onOpen} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )
    case "rule":
      return <hr />
  }
}

function Inlines({ parts, onOpen }: { parts: Inline[]; onOpen: Open }) {
  return (
    <>
      {parts.map((part, index) => {
        switch (part.type) {
          case "text":
            return part.text
          case "code":
            return <code key={index}>{part.text}</code>
          case "br":
            return <br key={index} />
          case "strong":
            return (
              <strong key={index}>
                <Inlines parts={part.children} onOpen={onOpen} />
              </strong>
            )
          case "em":
            return (
              <em key={index}>
                <Inlines parts={part.children} onOpen={onOpen} />
              </em>
            )
          case "del":
            return (
              <del key={index}>
                <Inlines parts={part.children} onOpen={onOpen} />
              </del>
            )
          case "link":
            return (
              <a
                key={index}
                href={part.href}
                onClick={(event) => {
                  event.preventDefault()
                  void window.dumpling.openLink(part.href)
                }}
              >
                <Inlines parts={part.children} onOpen={onOpen} />
              </a>
            )
          case "page-link":
            return (
              <button key={index} type="button" className="page-link" onClick={() => onOpen(part.id)}>
                {part.label}
              </button>
            )
          case "missing-link":
            return (
              <span key={index} className="missing-link" title="No such Page">
                {part.label}
                <span className="sr-only"> (no such Page)</span>
              </span>
            )
          case "elsewhere-link":
            return (
              <span key={index} className="elsewhere-link">
                {part.label}
              </span>
            )
        }
      })}
    </>
  )
}
