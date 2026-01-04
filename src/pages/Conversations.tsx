import { useState, useMemo } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useConversations, useConversationMessages, useSendMessage } from "@/hooks/useConversations";
import { formatDistanceToNow } from "date-fns";
import {
  Search,
  Send,
  Paperclip,
  MoreVertical,
  Phone,
  Video,
  Bot,
  User,
  CheckCheck,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
export default function Conversations() {
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  // Fetch conversations from API
  const { data: conversations = [], isLoading: conversationsLoading, error: conversationsError } = useConversations();
  // Fetch messages for selected conversation
  const { data: messages = [], isLoading: messagesLoading } = useConversationMessages(selectedConversationId);
  // Send message mutation
  const sendMessageMutation = useSendMessage();
  // Get selected conversation details
  const selectedConversation = useMemo(() => {
    if (!selectedConversationId) return null;
    return conversations.find(c => c.id === selectedConversationId);
  }, [conversations, selectedConversationId]);
  // Filter conversations by search
  const filteredConversations = useMemo(() => {
    if (!searchQuery) return conversations;
    const query = searchQuery.toLowerCase();
    return conversations.filter((conv) =>
      (conv.customer_name || '').toLowerCase().includes(query) ||
      (conv.customer_id || '').toLowerCase().includes(query)
  }, [conversations, searchQuery]);
  // Auto-select first conversation if none selected
  useMemo(() => {
    if (!selectedConversationId && conversations.length > 0) {
      setSelectedConversationId(conversations[0].id);
    }
  }, [conversations, selectedConversationId]);
  // Format time ago
  const formatTimeAgo = (dateString: string | null) => {
    if (!dateString) return 'Just now';
    try {
      return formatDistanceToNow(new Date(dateString), { addSuffix: true });
    } catch {
      return 'Just now';
    }
  };
  // Handle send message
  const handleSendMessage = async () => {
    if (!messageInput.trim() || !selectedConversation) return;
    const chatId = selectedConversation.telegram_chat_id;
    if (!chatId) {
      alert('No chat ID found for this conversation');
      return;
    }
    try {
      await sendMessageMutation.mutateAsync({
        chatId: chatId,
        text: messageInput.trim(),
      });
      setMessageInput("");
    } catch (error) {
      alert('Failed to send message. Please try again.');
    }
  };
  return (
    <DashboardLayout
      title="Conversations"
      subtitle="Manage customer chats and support requests"
    >
      <div className="flex h-[calc(100vh-180px)] rounded-xl border border-border bg-card overflow-hidden">
        {/* Conversation List */}
        <div className="w-80 border-r border-border flex flex-col">
          <div className="p-4 border-b border-border">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search conversations..."
                className="pl-9"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {conversationsLoading ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : conversationsError ? (
              <Alert className="m-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Failed to load conversations. Make sure the server is running.
                </AlertDescription>
              </Alert>
            ) : filteredConversations.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <p>No conversations found</p>
                <p className="text-sm mt-2">Send a message to your bot to start a conversation</p>
              </div>
            ) : (
              filteredConversations.map((conversation: any) => {
                const initials = (conversation.customer_name || 'U')
                  .split(' ')
                  .map((n: string) => n[0])
                  .join('')
                  .toUpperCase()
                  .slice(0, 2);
                const isSelected = selectedConversationId === conversation.id;
                const isTelegram = conversation.telegram_chat_id;
                return (
                  <div
                    key={conversation.id}
                    onClick={() => setSelectedConversationId(conversation.id)}
                    className={cn(
                      "flex items-center gap-3 p-4 cursor-pointer transition-colors border-b border-border",
                      isSelected ? "bg-accent/10" : "hover:bg-muted/50"
                    )}
                  >
                    <div className="relative">
                      <div className="h-12 w-12 rounded-full bg-whatsapp-light flex items-center justify-center">
                        <span className="text-sm font-semibold text-whatsapp-dark">
                          {initials}
                        </span>
                      </div>
                      {isTelegram ? (
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
                      <div className="flex items-center justify-between">
                        <p className="font-medium text-foreground truncate">
                          {conversation.customer_name || 'Unknown'}
                        </p>
                        <span className="text-xs text-muted-foreground">
                          {formatTimeAgo(conversation.last_message_at)}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground truncate">
                        {conversation.last_message || 'No messages yet'}
                      </p>
                    </div>
                    {conversation.message_count > 0 && (
                      <span className="h-5 min-w-5 px-1.5 rounded-full bg-whatsapp text-[10px] font-bold text-accent-foreground flex items-center justify-center">
                        {conversation.message_count}
                      </span>
                    )}
                  </div>
              })
            )}
          </div>
        </div>
        {/* Chat Area */}
        <div className="flex-1 flex flex-col">
          {!selectedConversation ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Select a conversation to start chatting</p>
              </div>
            </div>
          ) : (
            <>
              {/* Chat Header */}
              <div className="flex items-center justify-between p-4 border-b border-border">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-whatsapp-light flex items-center justify-center">
                    <span className="text-sm font-semibold text-whatsapp-dark">
                      {(selectedConversation.customer_name || 'U')
                        .split(' ')
                        .map((n: string) => n[0])
                        .join('')
                        .toUpperCase()
                        .slice(0, 2)}
                    </span>
                  </div>
                  <div>
                    <p className="font-medium text-foreground">
                      {selectedConversation.customer_name || 'Unknown'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {selectedConversation.telegram_chat_id 
                        ? `Telegram: ${selectedConversation.telegram_chat_id}`
                        : selectedConversation.customer_id || 'No contact info'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={selectedConversation.telegram_chat_id ? "info" : "warning"}>
                    {selectedConversation.telegram_chat_id ? "Telegram" : "WhatsApp"}
                  </Badge>
                  <Button variant="ghost" size="icon">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#e5ddd5]">
                {messagesLoading ? (
                  <div className="flex items-center justify-center p-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="text-center text-muted-foreground p-8">
                    <p>No messages yet</p>
                    <p className="text-sm mt-2">Start the conversation!</p>
                  </div>
                ) : (
                  messages.map((message: any) => {
                    const isInbound = message.direction === 'inbound';
                    const time = message.created_at 
                      ? new Date(message.created_at).toLocaleTimeString('en-US', { 
                          hour: '2-digit', 
                          minute: '2-digit' 
                        })
                      : 'Just now';
                    return (
                      <div
                        key={message.id}
                        className={cn(
                          "flex",
                          isInbound ? "justify-start" : "justify-end"
                        )}
                      >
                        <div
                          className={cn(
                            "max-w-[70%] rounded-lg px-4 py-2 shadow",
                            isInbound
                              ? "bg-card rounded-tl-none"
                              : "bg-whatsapp-light rounded-tr-none"
                          )}
                        >
                          <p className="text-sm text-foreground whitespace-pre-wrap">
                            {message.text}
                          </p>
                          <div className="flex items-center justify-end gap-1 mt-1">
                            <span className="text-[10px] text-muted-foreground">
                              {time}
                            </span>
                            {!isInbound && (
                              <CheckCheck
                                className={cn(
                                  "h-3 w-3",
                                  message.status === "read" || message.status === "delivered"
                                    ? "text-info"
                                    : "text-muted-foreground"
                                )}
                              />
                            )}
                          </div>
                        </div>
                      </div>
                  })
                )}
              </div>
              {/* Message Input */}
              <div className="p-4 border-t border-border bg-card">
                <div className="flex items-center gap-3">
                  <Button variant="ghost" size="icon">
                    <Paperclip className="h-5 w-5" />
                  </Button>
                  <Input
                    placeholder="Type a message..."
                    className="flex-1"
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && messageInput.trim() && !sendMessageMutation.isPending) {
                        handleSendMessage();
                      }
                    }}
                    disabled={sendMessageMutation.isPending || !selectedConversation?.telegram_chat_id}
                  />
                  <Button 
                    variant="whatsapp" 
                    size="icon"
                    onClick={handleSendMessage}
                    disabled={sendMessageMutation.isPending || !messageInput.trim() || !selectedConversation?.telegram_chat_id}
                  >
                    {sendMessageMutation.isPending ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Send className="h-5 w-5" />
                    )}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </DashboardLayout>
}
