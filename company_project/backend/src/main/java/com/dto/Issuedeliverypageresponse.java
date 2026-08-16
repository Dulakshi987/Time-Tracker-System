package com.dto;

import com.entity.Issue;
import java.util.List;

// Paged response for the Delivery Portal. Mirrors IssuePrintPageResponse's
// shape (content + page/size/totalElements/totalPages + stats) but keeps
// its own Stats block because Delivery needs a "cancelled" count that the
// Print Portal's Stats class doesn't have.
public class IssueDeliveryPageResponse {

    private List<Issue> content;
    private int page;
    private int size;
    private long totalElements;
    private int totalPages;
    private Stats stats;

    public IssueDeliveryPageResponse(List<Issue> content, int page, int size,
                                      long totalElements, int totalPages, Stats stats) {
        this.content = content;
        this.page = page;
        this.size = size;
        this.totalElements = totalElements;
        this.totalPages = totalPages;
        this.stats = stats;
    }

    public List<Issue> getContent() { return content; }
    public int getPage() { return page; }
    public int getSize() { return size; }
    public long getTotalElements() { return totalElements; }
    public int getTotalPages() { return totalPages; }
    public Stats getStats() { return stats; }

    // Stats are computed over the DATE-scoped set (before search/status/
    // division filters and before pagination) — same semantics the old
    // frontend used for its stat chips, so the chip numbers don't jump
    // around just because you're on page 2.
    public static class Stats {
        public long total;
        public long pending;
        public long onHold;
        public long completed;
        public long cancelled;
        public long overdue;

        public Stats(long total, long pending, long onHold, long completed, long cancelled, long overdue) {
            this.total = total;
            this.pending = pending;
            this.onHold = onHold;
            this.completed = completed;
            this.cancelled = cancelled;
            this.overdue = overdue;
        }
    }
}package com.dto;

import com.entity.Issue;
import java.util.List;

// Paged response for the Delivery Portal. Mirrors IssuePrintPageResponse's
// shape (content + page/size/totalElements/totalPages + stats) but keeps
// its own Stats block because Delivery needs a "cancelled" count that the
// Print Portal's Stats class doesn't have.
public class IssueDeliveryPageResponse {

    private List<Issue> content;
    private int page;
    private int size;
    private long totalElements;
    private int totalPages;
    private Stats stats;

    public IssueDeliveryPageResponse(List<Issue> content, int page, int size,
                                      long totalElements, int totalPages, Stats stats) {
        this.content = content;
        this.page = page;
        this.size = size;
        this.totalElements = totalElements;
        this.totalPages = totalPages;
        this.stats = stats;
    }

    public List<Issue> getContent() { return content; }
    public int getPage() { return page; }
    public int getSize() { return size; }
    public long getTotalElements() { return totalElements; }
    public int getTotalPages() { return totalPages; }
    public Stats getStats() { return stats; }

    // Stats are computed over the DATE-scoped set (before search/status/
    // division filters and before pagination) — same semantics the old
    // frontend used for its stat chips, so the chip numbers don't jump
    // around just because you're on page 2.
    public static class Stats {
        public long total;
        public long pending;
        public long onHold;
        public long completed;
        public long cancelled;
        public long overdue;

        public Stats(long total, long pending, long onHold, long completed, long cancelled, long overdue) {
            this.total = total;
            this.pending = pending;
            this.onHold = onHold;
            this.completed = completed;
            this.cancelled = cancelled;
            this.overdue = overdue;
        }
    }
}package com.dto;

import com.entity.Issue;
import java.util.List;

// Paged response for the Delivery Portal. Mirrors IssuePrintPageResponse's
// shape (content + page/size/totalElements/totalPages + stats) but keeps
// its own Stats block because Delivery needs a "cancelled" count that the
// Print Portal's Stats class doesn't have.
public class IssueDeliveryPageResponse {

    private List<Issue> content;
    private int page;
    private int size;
    private long totalElements;
    private int totalPages;
    private Stats stats;

    public IssueDeliveryPageResponse(List<Issue> content, int page, int size,
                                      long totalElements, int totalPages, Stats stats) {
        this.content = content;
        this.page = page;
        this.size = size;
        this.totalElements = totalElements;
        this.totalPages = totalPages;
        this.stats = stats;
    }

    public List<Issue> getContent() { return content; }
    public int getPage() { return page; }
    public int getSize() { return size; }
    public long getTotalElements() { return totalElements; }
    public int getTotalPages() { return totalPages; }
    public Stats getStats() { return stats; }

    // Stats are computed over the DATE-scoped set (before search/status/
    // division filters and before pagination) — same semantics the old
    // frontend used for its stat chips, so the chip numbers don't jump
    // around just because you're on page 2.
    public static class Stats {
        public long total;
        public long pending;
        public long onHold;
        public long completed;
        public long cancelled;
        public long overdue;

        public Stats(long total, long pending, long onHold, long completed, long cancelled, long overdue) {
            this.total = total;
            this.pending = pending;
            this.onHold = onHold;
            this.completed = completed;
            this.cancelled = cancelled;
            this.overdue = overdue;
        }
    }
}package com.dto;

import com.entity.Issue;
import java.util.List;

// Paged response for the Delivery Portal. Mirrors IssuePrintPageResponse's
// shape (content + page/size/totalElements/totalPages + stats) but keeps
// its own Stats block because Delivery needs a "cancelled" count that the
// Print Portal's Stats class doesn't have.
public class IssueDeliveryPageResponse {

    private List<Issue> content;
    private int page;
    private int size;
    private long totalElements;
    private int totalPages;
    private Stats stats;

    public IssueDeliveryPageResponse(List<Issue> content, int page, int size,
                                      long totalElements, int totalPages, Stats stats) {
        this.content = content;
        this.page = page;
        this.size = size;
        this.totalElements = totalElements;
        this.totalPages = totalPages;
        this.stats = stats;
    }

    public List<Issue> getContent() { return content; }
    public int getPage() { return page; }
    public int getSize() { return size; }
    public long getTotalElements() { return totalElements; }
    public int getTotalPages() { return totalPages; }
    public Stats getStats() { return stats; }

    // Stats are computed over the DATE-scoped set (before search/status/
    // division filters and before pagination) — same semantics the old
    // frontend used for its stat chips, so the chip numbers don't jump
    // around just because you're on page 2.
    public static class Stats {
        public long total;
        public long pending;
        public long onHold;
        public long completed;
        public long cancelled;
        public long overdue;

        public Stats(long total, long pending, long onHold, long completed, long cancelled, long overdue) {
            this.total = total;
            this.pending = pending;
            this.onHold = onHold;
            this.completed = completed;
            this.cancelled = cancelled;
            this.overdue = overdue;
        }
    }
}package com.dto;

import com.entity.Issue;
import java.util.List;

// Paged response for the Delivery Portal. Mirrors IssuePrintPageResponse's
// shape (content + page/size/totalElements/totalPages + stats) but keeps
// its own Stats block because Delivery needs a "cancelled" count that the
// Print Portal's Stats class doesn't have.
public class IssueDeliveryPageResponse {

    private List<Issue> content;
    private int page;
    private int size;
    private long totalElements;
    private int totalPages;
    private Stats stats;

    public IssueDeliveryPageResponse(List<Issue> content, int page, int size,
                                      long totalElements, int totalPages, Stats stats) {
        this.content = content;
        this.page = page;
        this.size = size;
        this.totalElements = totalElements;
        this.totalPages = totalPages;
        this.stats = stats;
    }

    public List<Issue> getContent() { return content; }
    public int getPage() { return page; }
    public int getSize() { return size; }
    public long getTotalElements() { return totalElements; }
    public int getTotalPages() { return totalPages; }
    public Stats getStats() { return stats; }

    // Stats are computed over the DATE-scoped set (before search/status/
    // division filters and before pagination) — same semantics the old
    // frontend used for its stat chips, so the chip numbers don't jump
    // around just because you're on page 2.
    public static class Stats {
        public long total;
        public long pending;
        public long onHold;
        public long completed;
        public long cancelled;
        public long overdue;

        public Stats(long total, long pending, long onHold, long completed, long cancelled, long overdue) {
            this.total = total;
            this.pending = pending;
            this.onHold = onHold;
            this.completed = completed;
            this.cancelled = cancelled;
            this.overdue = overdue;
        }
    }
}package com.dto;

import com.entity.Issue;
import java.util.List;

// Paged response for the Delivery Portal. Mirrors IssuePrintPageResponse's
// shape (content + page/size/totalElements/totalPages + stats) but keeps
// its own Stats block because Delivery needs a "cancelled" count that the
// Print Portal's Stats class doesn't have.
public class IssueDeliveryPageResponse {

    private List<Issue> content;
    private int page;
    private int size;
    private long totalElements;
    private int totalPages;
    private Stats stats;

    public IssueDeliveryPageResponse(List<Issue> content, int page, int size,
                                      long totalElements, int totalPages, Stats stats) {
        this.content = content;
        this.page = page;
        this.size = size;
        this.totalElements = totalElements;
        this.totalPages = totalPages;
        this.stats = stats;
    }

    public List<Issue> getContent() { return content; }
    public int getPage() { return page; }
    public int getSize() { return size; }
    public long getTotalElements() { return totalElements; }
    public int getTotalPages() { return totalPages; }
    public Stats getStats() { return stats; }

    // Stats are computed over the DATE-scoped set (before search/status/
    // division filters and before pagination) — same semantics the old
    // frontend used for its stat chips, so the chip numbers don't jump
    // around just because you're on page 2.
    public static class Stats {
        public long total;
        public long pending;
        public long onHold;
        public long completed;
        public long cancelled;
        public long overdue;

        public Stats(long total, long pending, long onHold, long completed, long cancelled, long overdue) {
            this.total = total;
            this.pending = pending;
            this.onHold = onHold;
            this.completed = completed;
            this.cancelled = cancelled;
            this.overdue = overdue;
        }
    }
}package com.dto;

import com.entity.Issue;
import java.util.List;

// Paged response for the Delivery Portal. Mirrors IssuePrintPageResponse's
// shape (content + page/size/totalElements/totalPages + stats) but keeps
// its own Stats block because Delivery needs a "cancelled" count that the
// Print Portal's Stats class doesn't have.
public class IssueDeliveryPageResponse {

    private List<Issue> content;
    private int page;
    private int size;
    private long totalElements;
    private int totalPages;
    private Stats stats;

    public IssueDeliveryPageResponse(List<Issue> content, int page, int size,
                                      long totalElements, int totalPages, Stats stats) {
        this.content = content;
        this.page = page;
        this.size = size;
        this.totalElements = totalElements;
        this.totalPages = totalPages;
        this.stats = stats;
    }

    public List<Issue> getContent() { return content; }
    public int getPage() { return page; }
    public int getSize() { return size; }
    public long getTotalElements() { return totalElements; }
    public int getTotalPages() { return totalPages; }
    public Stats getStats() { return stats; }

    // Stats are computed over the DATE-scoped set (before search/status/
    // division filters and before pagination) — same semantics the old
    // frontend used for its stat chips, so the chip numbers don't jump
    // around just because you're on page 2.
    public static class Stats {
        public long total;
        public long pending;
        public long onHold;
        public long completed;
        public long cancelled;
        public long overdue;

        public Stats(long total, long pending, long onHold, long completed, long cancelled, long overdue) {
            this.total = total;
            this.pending = pending;
            this.onHold = onHold;
            this.completed = completed;
            this.cancelled = cancelled;
            this.overdue = overdue;
        }
    }
}