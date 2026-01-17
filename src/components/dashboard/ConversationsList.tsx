import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MessageSquare, Bot, User } from "lucide-react";

const conversations = [
  {
    id: 1,
    customer: "Maria Santos",
    lastMessage: "Apakah bisa pesan untuk besok jam 12?",
    time: "2 min ago",
    unread: 3,
    isBot: false,
  },
  {
    id: 2,
    customer: "Joko Widodo",
    lastMessage: "Terima kasih, pesanannya sudah sampai!",
    time: "15 min ago",
    unread: 0,
    isBot: true,
  },
  {
    id: 3,
    customer: "Linda Kusuma",
    lastMessage: "Mau tanya menu vegetarian ada?",
    time: "30 min ago",
    unread: 1,
    isBot: false,
  },
  {
    id: 4,
    customer: "Rudi Hermawan",
    lastMessage: "Oke, saya tunggu ya",
    time: "1 hour ago",
    unread: 0,
    isBot: true,
  },
];

export function ConversationsList() {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between p-6 border-b border-border">
        <div>
          <h3 className="font-semibold text-foreground">Active Conversations</h3>
          <p className="text-sm text-muted-foreground">WhatsApp messages requiring attention</p>
        </div>
        <Button variant="whatsapp" size="sm">
          <MessageSquare className="h-4 w-4 mr-1" />
          Open Inbox
        </Button>
      </div>
      
      <div className="divide-y divide-border">
        {conversations.map((conversation) => (
          <div
            key={conversation.id}
            className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="h-10 w-10 rounded-full bg-whatsapp-light flex items-center justify-center">
                  <span className="text-sm font-medium text-whatsapp-dark">
                    {conversation.customer.split(" ").map(n => n[0]).join("")}
                  </span>
                </div>
                {conversation.isBot ? (
                  <div className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-info flex items-center justify-center ring-2 ring-card">
                    <Bot className="h-3 w-3 text-info-foreground" />
                  </div>
                ) : (
                  <div className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-warning flex items-center justify-center ring-2 ring-card">
                    <User className="h-3 w-3 text-warning-foreground" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-foreground">{conversation.customer}</p>
                  {conversation.isBot && (
                    <Badge variant="info" className="text-[10px] px-1.5 py-0">
                      Bot
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground truncate max-w-[200px]">
                  {conversation.lastMessage}
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">{conversation.time}</span>
              {conversation.unread > 0 && (
                <span className="h-5 min-w-5 px-1.5 rounded-full bg-whatsapp text-[10px] font-bold text-accent-foreground flex items-center justify-center">
                  {conversation.unread}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
