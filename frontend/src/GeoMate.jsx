
import { useEffect, useRef, useState } from "react";
import {
    Bot,
    X,
    Send,
    Sparkles,
    LoaderCircle,
    Trash2,
} from "lucide-react";

const SUGGESTIONS = [
    "What does NDVI tell me?",
    "Explain the active map layer",
    "How can satellite imagery detect urban growth?",
];

export default function GeoMate({ context }) {
    const [open, setOpen] = useState(false);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [messages, setMessages] = useState([
        {
            role: "model",
            text: "Hi! I'm GeoMate, your GeoTime assistant. Ask me about satellite imagery, vegetation, water, urban expansion or fire hotspots. 🌍",
        },
    ]);

    const bottomRef = useRef(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, loading, open]);

    async function sendMessage(text = input) {
        const question = text.trim();

        if (!question || loading) return;

        const previousMessages = messages;
        const updatedMessages = [
            ...previousMessages,
            { role: "user", text: question },
        ];

        setMessages(updatedMessages);
        setInput("");
        setLoading(true);

        try {
            const response = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: question,
                    history: previousMessages
                        .filter((item) => item.role === "user" || item.role === "model")
                        .slice(-10),
                    context,
                }),
            });

            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(data.message || "Unable to contact GeoMate.");
            }

            setMessages((current) => [
                ...current,
                { role: "model", text: data.reply },
            ]);
        } catch (error) {
            setMessages((current) => [
                ...current,
                {
                    role: "model",
                    text: error.message || "Something went wrong. Please try again.",
                },
            ]);
        } finally {
            setLoading(false);
        }
    }

    function handleSubmit(event) {
        event.preventDefault();
        sendMessage();
    }

    return (
        <div className="absolute bottom-24 right-4 z-50 sm:bottom-24 sm:right-6">
            {open && (
                <section
                    aria-label="GeoMate chat"
                    className="mb-3 flex h-[min(540px,calc(100dvh-150px))] w-[min(370px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0b1018]/97 shadow-2xl shadow-black/50 backdrop-blur-xl"
                >
                    <header className="flex items-center justify-between border-b border-white/10 bg-[#111c29] p-4">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-400/15 text-emerald-300">
                                <Bot size={22} />
                            </div>
                            <div>
                                <h2 className="text-sm font-semibold text-white">GeoMate</h2>
                                <p className="flex items-center gap-1.5 text-[11px] text-emerald-300">
                                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                                    Powered by Gemini
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                onClick={() =>
                                    setMessages([
                                        {
                                            role: "model",
                                            text: "Chat cleared! What would you like to explore? 🌍",
                                        },
                                    ])
                                }
                                title="Clear conversation"
                                aria-label="Clear conversation"
                                className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white"
                            >
                                <Trash2 size={16} />
                            </button>
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                aria-label="Close GeoMate"
                                className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white"
                            >
                                <X size={18} />
                            </button>
                        </div>
                    </header>

                    <div className="flex-1 space-y-4 overflow-y-auto p-4">
                        <div className="rounded-xl border border-emerald-400/10 bg-emerald-400/5 p-3">
                            <p className="flex items-center gap-2 text-xs font-medium text-emerald-300">
                                <Sparkles size={14} />
                                Your geospatial copilot
                            </p>
                            <p className="mt-1 text-[11px] leading-5 text-slate-400">
                                I can help explain your map, satellite observations and
                                environmental indicators.
                            </p>
                        </div>

                        {messages.map((item, index) => (
                            <div
                                key={index}
                                className={`flex ${item.role === "user" ? "justify-end" : "justify-start"}`}
                            >
                                <div
                                    className={`max-w-[88%] whitespace-pre-wrap wrap-break-word rounded-2xl px-3.5 py-3 text-[13px] leading-5 ${item.role === "user"
                                            ? "rounded-br-sm bg-emerald-400 text-[#06110c]"
                                            : "rounded-bl-sm border border-white/10 bg-white/5 text-slate-200"
                                        }`}
                                >
                                    {item.text}
                                </div>
                            </div>
                        ))}

                        {messages.length === 1 && (
                            <div className="space-y-2">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                                    Try asking
                                </p>
                                {SUGGESTIONS.map((suggestion) => (
                                    <button
                                        key={suggestion}
                                        type="button"
                                        onClick={() => sendMessage(suggestion)}
                                        className="block w-full rounded-xl border border-white/10 px-3 py-2.5 text-left text-xs text-slate-300 transition hover:border-emerald-400/40 hover:bg-emerald-400/5"
                                    >
                                        {suggestion}
                                    </button>
                                ))}
                            </div>
                        )}

                        {loading && (
                            <div className="flex items-center gap-2 text-xs text-emerald-300">
                                <LoaderCircle size={15} className="animate-spin" />
                                GeoMate is thinking...
                            </div>
                        )}
                        <div ref={bottomRef} />
                    </div>

                    <form
                        onSubmit={handleSubmit}
                        className="flex items-center gap-2 border-t border-white/10 p-3"
                    >
                        <input
                            value={input}
                            onChange={(event) => setInput(event.target.value)}
                            placeholder="Ask GeoMate anything..."
                            maxLength={2000}
                            aria-label="Message GeoMate"
                            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-xs text-white outline-none placeholder:text-slate-500 focus:border-emerald-400/50"
                        />
                        <button
                            type="submit"
                            disabled={!input.trim() || loading}
                            aria-label="Send message"
                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-400 text-[#06110c] transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            <Send size={17} />
                        </button>
                    </form>
                </section>
            )}

            <div className="flex justify-end">
                <button
                    type="button"
                    onClick={() => setOpen((value) => !value)}
                    aria-label={open ? "Close GeoMate chat" : "Open GeoMate chat"}
                    aria-expanded={open}
                    className="flex h-14 w-14 items-center justify-center rounded-full border border-emerald-200/20 bg-emerald-400 text-[#06110c] shadow-xl shadow-emerald-500/20 transition hover:scale-105 hover:bg-emerald-300"
                >
                    {open ? <X size={23} /> : <Bot size={25} />}
                </button>
            </div>
        </div>
    );
}
