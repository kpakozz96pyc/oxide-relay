import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { User, apiPost, buildErrorMessage } from "../../api";

export function CreateUserDialog({
  open,
  canManageUsers,
  onClose,
  onCreated,
}: {
  open: boolean;
  canManageUsers: boolean;
  onClose: () => void;
  onCreated: (user: User) => void;
}) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (!open) {
      setEmail("");
      setDisplayName("");
      setPassword("");
    }
  }, [open]);

  const createUserMutation = useMutation({
    mutationFn: async () =>
      apiPost<User>("/api/v1/users", {
        email,
        display_name: displayName,
        password,
        is_active: true,
      }),
    onSuccess: async (user) => {
      await queryClient.invalidateQueries({ queryKey: ["users-summary"] });
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      onCreated(user);
      onClose();
    },
  });

  if (!open) {
    return null;
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="create-user-title">
      <div className="modal-card panel stack gap-md">
        <header className="panel-header">
          <div className="stack gap-sm">
            <h2 id="create-user-title">New user</h2>
            <p className="panel-copy">Create a new user record without leaving the users workspace.</p>
          </div>
          <button className="button ghost" onClick={onClose} type="button" aria-label="Close create user dialog">
            <X size={16} />
          </button>
        </header>

        {createUserMutation.isError ? (
          <div className="banner error">{buildErrorMessage(createUserMutation.error)}</div>
        ) : null}

        <div className="stack gap-md">
          <label className="field">
            <span>Email</span>
            <input value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label className="field">
            <span>Display name</span>
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
        </div>

        <div className="action-row">
          <button
            className="button primary"
            disabled={createUserMutation.isPending || !canManageUsers || !email.trim() || !displayName.trim() || !password.trim()}
            onClick={() => createUserMutation.mutate()}
            type="button"
          >
            {createUserMutation.isPending ? "Creating..." : "Create user"}
          </button>
          <button className="button ghost" onClick={onClose} type="button">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
