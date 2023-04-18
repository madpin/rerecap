import { Storage } from "@plasmohq/storage"
import baseCssText from "data-text:~/style.css"
import type { PlasmoCSConfig, PlasmoGetOverlayAnchor } from "plasmo"
import { useEffect, useMemo, useRef, useState } from "react"
import { ResultTextArea } from "~components/contents"
import ProviderInfo from "~components/provider-info"
import { ConfigKeys, PanelPosition, Theme, urlNormalize } from "~config"
import { MessageNames } from "~constants"
import { useTheme } from "~hooks"
import {
  VscChromeClose as CloseIcon,
  VscLayoutPanel as DockBottomIcon,
  VscLayoutPanelOff as DockBottomOffIcon,
  VscLayoutSidebarLeft as DockLeftIcon,
  VscLayoutSidebarLeftOff as DockLeftOffIcon,
  VscLayoutSidebarRight as DockRightIcon,
  VscLayoutSidebarRightOff as DockRightOffIcon,
  IoRefreshCircleOutline as RerunIcon
} from "~icons"
import { classNames } from "~utils"
import { usePageContent } from "./hooks/page-content"
import {
  SummaryContent,
  SummaryStatus,
  isRunningStatus,
  useSummaryContent
} from "./hooks/summary-content"

export const config: PlasmoCSConfig = {
  matches: ["http://*/*", "https://*/*"]
}

export const getStyle = () => {
  const style = document.createElement("style")
  style.textContent = baseCssText
  return style
}

export const getOverlayAnchor: PlasmoGetOverlayAnchor = async () =>
  document.body

const PanelOverlay = () => {
  const [theme] = useTheme()
  const [show, setShow] = useState(false)
  const [position, setPosition] = useState<PanelPosition>()
  const enabledRef = useRef(false)
  const textContent = useRef("")
  const [summarySource, setSummarySource] = useState<"page" | "text">()
  const [summaryContent, setSummaryContent] = useState<SummaryContent>(null)

  const [articleSummary, startSummarizeArticle] = useSummaryContent()
  const [textSummary, startSummarizeText] = useSummaryContent()
  const articleSummaryRef = useRef<SummaryContent>(null)
  const textSummaryRef = useRef<SummaryContent>(null)

  const [pageSummary, setPageSummary] = useState<SummaryContent[]>([])
  const pendingSumarizePage = useRef(false)

  const {
    enabled,
    enabledDetails,
    content: pageContent
  } = usePageContent(urlNormalize(location.href))

  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  useEffect(() => {
    ;(async () => {
      const storage = new Storage()

      setPosition(await storage.get(ConfigKeys.panelPosition))
    })()
  }, [])

  useEffect(() => {
    if (enabledDetails === undefined) {
      return
    }

    chrome.runtime.sendMessage({
      name: MessageNames.UpdateActionIcon,
      enabledDetails
    })
  }, [enabledDetails])

  // TODO: should can be deleted
  useEffect(() => {
    if (pendingSumarizePage.current) {
      pendingSumarizePage.current = false
      summarizePage()
    }
  }, [pageContent])

  useEffect(() => {
    const listener = function (msg) {
      if (msg?.name === MessageNames.TogglePanel) {
        setShow((show) => !show)
      } else if (msg?.name === MessageNames.SummarizeText) {
        setShow(true)
        setSummarySource("text")
        if (isRunningStatus(textSummaryRef.current?.status)) {
          // TODO: show notification to user that there is a pending summary
          return
        }
        textContent.current = msg?.text
        startSummarizeText(textContent.current)
      } else if (msg?.name === MessageNames.SummarizePage) {
        setShow(true)
        setSummarySource("page")
        if (!enabledRef.current) {
          setSummaryContent({
            status: SummaryStatus.Error,
            data: { message: "Recap is disabled on this page" }
          })
          return
        }
        if (
          articleSummaryRef.current === null ||
          articleSummaryRef.current.status === SummaryStatus.Error
        ) {
          summarizePage()
        }
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => {
      chrome.runtime.onMessage.removeListener(listener)
    }
  }, [])

  useEffect(() => {
    if (summarySource === "page") {
      if (!articleSummary) {
        return
      }

      let text = ""
      if (pageSummaryHeader) {
        text += pageSummaryHeader + "\n\n"
      }

      if (pageSummaryFinished) {
        text += pageSummaryFinished + "\n\n"
      }

      if (articleSummary) {
        if (articleSummary.status !== SummaryStatus.Finish) {
          text += articleSummary.data
        }
      }

      setSummaryContent({ status: SummaryStatus.Finish, data: text })
    } else if (summarySource == "text") {
      setSummaryContent(textSummary)
    }
  }, [summarySource, articleSummary, textSummary, pageSummary])

  const pageSummaryHeader = useMemo(() => {
    if (!pageContent) {
      return ""
    }

    let text = ""
    if (pageContent.articles.length > 1) {
      if (pageContent.title) {
        text += "Page Title: " + pageContent.title + "\n"
      }
      text += `There are ${pageContent.articles.length} articles in this page.`
    }
    return text
  }, [pageContent])

  const pageSummaryFinished = useMemo(() => {
    let text = ""
    text += pageSummary
      .map((article, idx) => {
        let lines = [`Article #${idx + 1}`]
        if (pageContent.articles[idx].title) {
          lines.push(`Title: ${pageContent.articles[idx].title}`)
          lines.push(`Summary: ${article.data}`)
        }
        return lines.join("\n")
      })
      .join("\n\n")

    return text
  }, [pageSummary])

  useEffect(() => {
    if (articleSummary) {
      articleSummaryRef.current = articleSummary

      if (articleSummary.status === SummaryStatus.Finish) {
        const newPageSummary = [...pageSummary]
        newPageSummary.push(articleSummary)
        if (newPageSummary.length < pageContent.articles.length) {
          startSummarizeArticle(
            pageContent.articles[newPageSummary.length].content
          )
        }
        setPageSummary(newPageSummary)
      }
    }
  }, [articleSummary])

  useEffect(() => {
    if (textSummary) {
      textSummaryRef.current = textSummary
    }
  }, [textSummary])

  function rerun() {
    if (summarySource === "text") {
      startSummarizeText(textContent.current)
    }

    if (summarySource === "page") {
      summarizePage()
    }
  }

  function summarizePage() {
    if (!pageContent) {
      setSummaryContent({
        status: SummaryStatus.Loading,
        data: {
          message: "Parsing page content..."
        }
      })
      pendingSumarizePage.current = true
      return
    }

    if (pageContent.articles.length === 0) {
      setSummaryContent({
        status: SummaryStatus.Error,
        data: { message: "No article found in this page.", showBugReport: true }
      })
      return
    }
    setPageSummary([])
    startSummarizeArticle(pageContent.articles[0].content)
  }

  return (
    <>
      {show && position !== undefined ? (
        <div className={`${theme == Theme.Dark ? "dark" : ""}`}>
          <div
            className={classNames(
              position == PanelPosition.Bottom
                ? "bottom-6 right-8 left-8 h-[240]"
                : "",
              position == PanelPosition.Left
                ? "top-16 left-8 h-[500] w-[448]"
                : "",
              position == PanelPosition.Right
                ? "top-16 right-8 h-[500] w-[448]"
                : "",
              isRunningStatus(summaryContent?.status)
                ? "cursor-wait"
                : "cursor-default",
              "fixed overflow-hidden rounded-2xl bg-white text-black shadow-lg shadow-neutral-300 dark:bg-neutral-900 dark:text-white"
            )}>
            <div
              className={classNames(
                position == PanelPosition.Bottom ? "right-8 left-8" : "",
                position == PanelPosition.Left ? "w-[448]" : "",
                position == PanelPosition.Right ? "w-[448]" : "",
                "fixed flex cursor-default flex-row justify-between rounded-t-2xl bg-neutral-200 px-2 py-4 dark:bg-neutral-800"
              )}>
              <button
                className="cursor-pointer hover:text-slate-500 dark:hover:text-slate-400"
                onClick={() => {
                  setShow(false)
                }}>
                <CloseIcon className="h-6 w-6" />
              </button>
              <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-row items-center gap-1">
                <img
                  src={chrome.runtime.getURL("assets/icon.svg")}
                  className="h-6 w-6 rounded-lg object-scale-down"
                />
                <span className="font-[cursive]">Recap</span>
              </div>
              <div className="flex flex-row items-center gap-2">
                <button
                  className="cursor-pointer enabled:hover:text-slate-500 disabled:cursor-not-allowed disabled:opacity-50 enabled:dark:hover:text-slate-400"
                  disabled={
                    !enabled ||
                    !summaryContent ||
                    isRunningStatus(summaryContent?.status)
                  }
                  onClick={(e) => {
                    rerun()
                  }}>
                  <RerunIcon className="h-6 w-6" />
                </button>
                <div className="flex flex-row">
                  {[
                    {
                      icon: DockLeftIcon,
                      offIcon: DockLeftOffIcon,
                      position: PanelPosition.Left
                    },
                    {
                      icon: DockBottomIcon,
                      offIcon: DockBottomOffIcon,
                      position: PanelPosition.Bottom
                    },
                    {
                      icon: DockRightIcon,
                      offIcon: DockRightOffIcon,
                      position: PanelPosition.Right
                    }
                  ].map((value, id) => {
                    return (
                      <div className="flex flex-row items-center" key={id}>
                        {position === value.position ? (
                          <button
                            className="cursor-pointer hover:text-slate-500 dark:hover:text-slate-400"
                            onClick={() => {
                              setPosition(value.position)
                            }}>
                            <value.icon className="h-6 w-6" />
                          </button>
                        ) : (
                          <button
                            className="cursor-pointer hover:text-slate-500 dark:hover:text-slate-400"
                            onClick={() => {
                              setPosition(value.position)
                            }}>
                            <value.offIcon className="h-6 w-6" />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
            <div className="absolute top-[56] bottom-[32] w-full">
              <ResultTextArea content={summaryContent} />
            </div>
            <div className="absolute bottom-0 w-full">
              <ProviderInfo />
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

export default PanelOverlay
