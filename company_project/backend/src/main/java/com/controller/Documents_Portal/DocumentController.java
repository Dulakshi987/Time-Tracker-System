package com.controller.Documents_Portal;

// import java.util.Map;
import java.time.LocalDateTime;
// import java.util.ArrayList;
// import java.util.HashMap;
import java.util.List;

import com.entity.Document;
import com.repository.DocumentRepository;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/documents")
@CrossOrigin(origins = "http://localhost:5173")
public class DocumentController {

    @Autowired
    private DocumentRepository repository;

    // ================= SAVE =================
    @PostMapping
    public ResponseEntity<?> saveDocument(@RequestBody Document document) {

        try {

            System.out.println("SAVE API HIT");

            //AUTO SET DATETIME (NO NEED FRONTEND)
            document.setCreatedDatetime(LocalDateTime.now());

            Document saved = repository.save(document);

            return ResponseEntity.ok(saved);

        } catch (Exception e) {

            e.printStackTrace();

            return ResponseEntity
                    .badRequest()
                    .body(e.getMessage());
        }
    }

    // ================= GET BY TYPE =================
    @GetMapping("/type/{type}")
    public List<Document> getByType(@PathVariable String type) {

        if (type.equalsIgnoreCase("All")) {
            return repository.findAll();
        }

        return repository.findByJobType(type);
    }

    // ================= GET ALL =================
    @GetMapping
    public List<Document> getAll(
        @RequestParam(required = false) String fromDate,
        @RequestParam(required = false) String toDate,
        @RequestParam(required = false) String type
) {

    if (fromDate != null && toDate != null) {
        return repository.findByDateRange(fromDate, toDate);
    }

    if (type != null && !type.equalsIgnoreCase("All")) {
        return repository.findByJobType(type);
    }

    return repository.findAll();
}
} 